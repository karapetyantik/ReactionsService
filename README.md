# ReactionsService

Реакции (эмодзи) на сообщения платформы **Tapik**. Хранит реакции в ScyllaDB/Cassandra, кэширует агрегированную сводку в Redis, проверяет членство в чате через gRPC к ChatService и рассылает изменения через RabbitMQ.

## Роль в системе

```
Клиент ──POST/DELETE/GET /messages/:id/reactions──▶ ReactionsService
                                                            │
                                              gRPC (x-internal-key)
                                                            ▼
                                                      ChatService (IsMember, GetChatMembers)
                                                            │
                                              message.reaction (RMQ) ──▶ ChatService (доставка в сокеты)
```

## Технологии

- **NestJS 11**, HTTP-only на вход, gRPC-клиент + RabbitMQ producer на выход
- **ScyllaDB/Cassandra** (`cassandra-driver`) — таблица `message_reactions`
- **Redis** — кэш агрегированной сводки реакций (TTL 60с) + debounce-блокировка на дублирующиеся запросы
- **gRPC** — клиент к `ChatInternal` (ChatService)
- Path-алиасы: `@common/*`, `@modules/*`, `@proto/*`

## Возможности

- Добавление/удаление реакции конкретным эмодзи (удаление всегда затрагивает только указанный эмодзи, а не все реакции пользователя на сообщении).
- Debounce одинаковых запросов (add/remove) через Redis-блокировку (`NX`, TTL 3с) — защита от двойного клика/дублирующихся сетевых ретраев.
- Проверка членства в чате перед любым действием (`IsMember` по gRPC к ChatService).
- Агрегированная сводка `{ emoji: [userId, ...] }` с кэшем в Redis.

## API (`/messages/:messageId/reactions`)

Все эндпоинты требуют `JwtAuthGuard`.

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/messages/:messageId/reactions` | Добавить реакцию (`{ chatId, emoji }`) |
| `DELETE` | `/messages/:messageId/reactions` | Убрать реакцию (`{ chatId, emoji }`) |
| `GET` | `/messages/:messageId/reactions` | Сводка реакций на сообщении |

## Внутренние вызовы

Использует `chat.proto` (`ChatInternal`) с metadata `x-internal-key: <INTERNAL_API_KEY>`:
- `IsMember` — перед add/remove.
- `GetChatMembers` — список получателей для рассылки `message.reaction`.

## RabbitMQ

**Публикует:** `message.reaction` — ChatService подхватывает это событие и доставляет его подключённым по WebSocket клиентам.

## Переменные окружения

| Переменная | Обязательна | Назначение |
|---|---|---|
| `PORT` | нет (3003) | HTTP-порт |
| `JWT_SECRET` | да | Проверка access-токенов |
| `SCYLLA_CONTACT_POINT` / `SCYLLA_PORT` / `SCYLLA_KEYSPACE` | да | ScyllaDB/Cassandra |
| `REDIS_HOST` / `REDIS_PORT` | да | Кэш сводки + debounce-блокировки |
| `RABBITMQ_URL` | да | AMQP |
| `CHAT_SERVICE_GRPC_URL` | да | Адрес gRPC-сервера ChatService |
| `INTERNAL_API_KEY` | да | Shared-secret для вызовов к ChatService |

## Структура проекта

```
src/
├── main.ts
├── common/
│   ├── auth/        # JwtStrategy, JwtAuthGuard, AuthenticatedRequest
│   ├── cassandra/    # CassandraService
│   └── redis/         # RedisService
├── modules/
│   ├── chats-client/  # gRPC-клиент к ChatService + internal-key metadata
│   └── reactions/
│       ├── reactions.controller.ts / reactions.service.ts
│       └── dto/         # ReactionDto, RemoveReactionDto
└── proto/
    └── chat.proto
```

## Запуск

```bash
npm install

npm run start:dev
npm run build && npm run start:prod
npm run test
npm run lint
```

Требует поднятый ScyllaDB/Cassandra keyspace (таблица `message_reactions`), Redis, RabbitMQ, доступный gRPC ChatService.

## Безопасность и корректность

- Удаление реакции всегда указывает конкретный emoji — раньше удалялись все реакции пользователя на сообщении разом.
- Исходящие gRPC-вызовы к ChatService подписаны shared-secret заголовком.
- Debounce-блокировка есть и на добавление, и на удаление (раньше — только на добавление).
