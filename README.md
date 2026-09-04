# ReactionsService — подробная документация (все файлы)

Микросервис реакций (эмодзи) на сообщения. Хранилище — ScyllaDB/Cassandra. Проверяет членство в чате через gRPC-вызов к `ChatService`, кеширует агрегированные реакции в Redis, публикует события в общую очередь `chat_events`, которую разбирает `DeliveryController` в `ChatService` для доставки по WebSocket.

---

## 1. Дерево модуля

```
src/
├── main.ts
├── app.module.ts / app.controller.ts / app.service.ts
├── common/
│   ├── auth/       (jwt.strategy.ts, jwt-auth.guard.ts, auth.module.ts)
│   ├── cassandra/  (cassandra.module.ts, cassandra.service.ts)
│   └── redis/      (redis.module.ts, redis.service.ts)
├── proto/chat.proto             — контракт ChatInternal (клиент здесь)
└── modules/
    ├── chats-client/
    │   ├── chats-client.module.ts
    │   └── chats-client.service.ts   — gRPC-клиент к ChatService
    └── reactions/
        ├── reactions.module.ts / reactions.controller.ts / reactions.service.ts
        └── dto/reaction.dto.ts
```

---

## 2. `main.ts` — точка входа

Самый простой bootstrap среди всех шести сервисов: только HTTP (`ValidationPipe` глобально, порт `PORT`, по умолчанию `3003`). Никаких RabbitMQ-консьюмеров или gRPC-серверов сервис не поднимает — он **только** HTTP-API + RabbitMQ-publisher + gRPC-**клиент** (к `ChatService`).

## 3. `app.module.ts`

Импортирует `ConfigModule` (global), `AuthModule`, `ChatsClientModule`, `ReactionsModule`, `RedisModule`. `CassandraModule` в `app.module.ts` напрямую не импортирован — он подключается внутри `ReactionsModule` (см. раздел 8).

## 4. `common/auth/`, `common/cassandra/`, `common/redis/`

Идентичны по коду соответствующим модулям в `ChatService` (тот же `JWT_SECRET`, тот же `cassandra-driver` с `SCYLLA_CONTACT_POINT`/`SCYLLA_KEYSPACE`, тот же `ioredis`).

## 5. `proto/chat.proto`

Тот же контракт `ChatInternal` (`GetChatMembers`, `IsMember`), что и в `ChatService` — здесь используется как основа для **клиента** (`ChatsClientService`), тогда как в `ChatService` этот же файл описывает реализацию **сервера**.

---

## 6. `modules/chats-client/` — gRPC-клиент к `ChatService`

### `chats-client.module.ts`
Регистрирует `ClientsModule` под именем `CHAT_GRPC_SERVICE`: транспорт `GRPC`, `package: 'chat'`, `protoPath: join(__dirname, '../proto/chat.proto')` (путь относительно скомпилированного `dist`), `url: CHAT_SERVICE_GRPC_URL` (обязательная переменная окружения — адрес gRPC-сервера `ChatService`, порт `5001` по умолчанию в самом `ChatService`).

### `chats-client.service.ts`
```ts
interface ChatInternalGrpcService {
  getChatMembers(data: { chatId: string }): Observable<{ memberIds: string[] }>;
  isMember(data: { chatId: string; userId: string }): Observable<{ isMember: boolean }>;
}
```
- `onModuleInit()` получает типизированный прокси через `client.getService<ChatInternalGrpcService>('ChatInternal')`.
- `getChatMembers(chatId)` / `isMember(chatId, userId)` — тонкие обёртки, превращающие RxJS `Observable` в `Promise` через `firstValueFrom`.
- Используется `ReactionsService` для проверки прав и получения списка получателей уведомлений.

---

## 7. `modules/reactions/dto/reaction.dto.ts`

```ts
class ReactionDto {
  @IsUUID() chatId!: string;
  @IsString() @MinLength(1) @MaxLength(8) emoji!: string;
}
```
Используется только в `POST`-запросе на добавление реакции (см. раздел 9).

## 8. `modules/reactions/reactions.module.ts`

Импортирует `RedisModule`, `CassandraModule`, `ChatsClientModule`, регистрирует `ClientsModule` (`RABBITMQ_SERVICE`, очередь `chat_events`, durable) — та же очередь, что использует `ChatService` для `message.sent`/`chat.read`; таким образом обе точки публикации событий (`ChatService` и `ReactionsService`) пишут в единую durable-очередь, из которой читает `DeliveryController` внутри `ChatService`.

## 9. `modules/reactions/reactions.controller.ts` — REST `/messages/:messageId/reactions`

Весь контроллер защищён `JwtAuthGuard`.

| Метод | HTTP | Валидация тела | Проверка членства |
|---|---|---|---|
| `add` | POST | `ReactionDto` (`chatId` — UUID, `emoji` — 1–8 симв.) | Да (внутри сервиса) |
| `remove` | DELETE | `chatId` — `@Body('chatId')`, **без DTO/валидации** | Да (внутри сервиса) |
| `list` | GET | — | **Нет** |

## 10. `modules/reactions/reactions.service.ts` — бизнес-логика

### 10.1. `addReaction(chatId, messageId, userId, emoji)`
1. Redis-блокировка от дублей: `SET reaction_lock:{messageId}:{userId}:{emoji} 1 EX 3 NX`. При неудаче (лок уже занят) — возвращает `{ ..., duplicate: true }` без обращения к Cassandra/gRPC.
2. Проверка членства через gRPC (`chatsClient.isMember`) — иначе `ForbiddenException('Вы не состоите в этом чате')`.
3. `INSERT INTO message_reactions (message_id, user_id, chat_id, emoji, created_at) VALUES (...)`.
4. Инвалидация кеша: `DEL reactions_cache:{messageId}`.
5. Получение участников чата (`chatsClient.getChatMembers`) и публикация `rabbitClient.emit('message.reaction', { chatId, messageId, userId, emoji, action: 'add', recipientIds })`.
6. Возврат `{ chatId, messageId, userId, emoji }`.

**Модель данных:** судя по `DELETE ... WHERE message_id = ? AND user_id = ?` (без `emoji`), таблица `message_reactions`, вероятно, имеет составной PK `(message_id, user_id)` — один пользователь может иметь только одну активную реакцию на сообщение; повторный `addReaction` с другим `emoji` перезаписывает предыдущую реакцию того же пользователя.

### 10.2. `removeReaction(chatId, messageId, userId)`
1. Проверка членства (`isMember`) — `ForbiddenException`, если нет.
2. `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?` — удаляет **любую** реакцию пользователя на сообщение, независимо от конкретного эмодзи (параметр `emoji` в метод не передаётся).
3. Инвалидация кеша, получение участников, публикация `message.reaction` с `action: 'remove'` (без поля `emoji` — оно неизвестно на момент удаления).

**Отличие от `addReaction`:** здесь нет Redis-блокировки от дублей — повторный быстрый вызов приведёт к двум `DELETE` и двум событиям `action: 'remove'`.

### 10.3. `getReactions(messageId)`
Cache-aside: `GET reactions_cache:{messageId}` → при промахе `SELECT user_id, emoji FROM message_reactions WHERE message_id = ?`, группировка в `{ emoji: [userId, ...] }`, запись в кеш с TTL 60 сек.

**В отличие от `ProfileService` (`UserService`), здесь ключ кеша формируется идентично во всех местах** (`reactions_cache:${messageId}` — без опечаток и лишних символов) — инвалидация работает корректно.

---

## 11. Используемые ключи Redis

| Ключ | Назначение | TTL |
|---|---|---|
| `reaction_lock:{messageId}:{userId}:{emoji}` | Дедупликация повторных запросов на добавление одной и той же реакции | 3 сек |
| `reactions_cache:{messageId}` | Кеш агрегированной сводки реакций | 60 сек |

---

## 12. Интеграции — сводная таблица

| Канал | Направление | Партнёр | Что передаётся |
|---|---|---|---|
| gRPC-клиент (`ChatInternal`) | вызывает | `ChatService` | `IsMember`, `GetChatMembers` |
| RabbitMQ (`chat_events`) | публикует | `ChatService` (`DeliveryController`) | `message.reaction` |
| Cassandra/ScyllaDB | хранилище | — | таблица `message_reactions` |
| Redis | кеш + дедупликация | — | `reaction_lock:*`, `reactions_cache:*` |

Сервис не подписывается ни на одно событие RabbitMQ — только публикует.

---

## 13. Сводные замечания

1. **`GET /messages/:messageId/reactions` не проверяет членство в чате** — любой авторизованный пользователь системы может получить сводку реакций на любое сообщение, зная его `messageId`, независимо от того, состоит ли он в соответствующем чате.
2. **`isMember` проверяет членство только в переданном клиентом `chatId`, но не то, что `messageId` действительно принадлежит этому чату** — участник чата A теоретически может поставить/снять реакцию на сообщение из чата B, указав `chatId` чата A (если каким-то образом узнает `messageId` из чата B).
3. **`DELETE`-эндпоинт принимает `chatId` без валидации** (`@Body('chatId')` вместо DTO), в отличие от `POST`, где `chatId` проверяется как UUID через `ReactionDto`.
4. **`removeReaction` не защищена Redis-блокировкой от дублей** (в отличие от `addReaction`) и удаляет реакцию без учёта конкретного эмодзи — возможны дублирующиеся события `action: 'remove'` при двойных кликах.
5. **Redis-лок в `addReaction` устанавливается до проверки прав** — если пользователь не состоит в чате, лок всё равно занят на 3 секунды, что может ненадолго помешать легитимному повторному запросу сразу после исправления членства.
6. **Emoji не передаётся в событии `action: 'remove'`** — подписчики (`DeliveryController` в `ChatService`) не могут показать клиенту, какая именно реакция была снята, без дополнительного запроса к `GET /messages/:messageId/reactions`.
7. Сообщения об ошибках — на русском, без i18n, как и во всех остальных сервисах системы.
