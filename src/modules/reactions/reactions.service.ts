import { Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CassandraService } from '@common/cassandra/cassandra.service';
import { ChatsClientService } from '../chats-client/chats-client.service';
import { RedisService } from '@common/redis/redis.service';

const REACTION_LOCK_TTL_SECONDS = 3;
const REACTIONS_CACHE_TTL_SECONDS = 60;

type ReactionAction = 'add' | 'remove';

@Injectable()
export class ReactionsService {
  constructor(
    private readonly cassandra: CassandraService,
    private readonly chatsClient: ChatsClientService,
    private readonly redisService: RedisService,
    @Inject('RABBITMQ_SERVICE') private readonly rabbitClient: ClientProxy,
  ) {}

  async addReaction(
    chatId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ) {
    const acquired = await this.acquireLock('add', messageId, userId, emoji);
    if (!acquired) {
      return { chatId, messageId, userId, emoji, duplicate: true };
    }

    await this.assertMember(chatId, userId);

    await this.cassandra.client.execute(
      `INSERT INTO message_reactions (message_id, user_id, chat_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)`,
      [messageId, userId, chatId, emoji, new Date()],
      { prepare: true },
    );

    await this.invalidateAndNotify(chatId, messageId, userId, emoji, 'add');

    return { chatId, messageId, userId, emoji };
  }

  async removeReaction(
    chatId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ) {
    const acquired = await this.acquireLock('remove', messageId, userId, emoji);
    if (!acquired) {
      return { chatId, messageId, userId, emoji, duplicate: true };
    }

    await this.assertMember(chatId, userId);

    await this.cassandra.client.execute(
      `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`,
      [messageId, userId, emoji],
      { prepare: true },
    );

    await this.invalidateAndNotify(chatId, messageId, userId, emoji, 'remove');

    return { chatId, messageId, userId, emoji };
  }

  async getReactions(messageId: string): Promise<Record<string, string[]>> {
    const cacheKey = this.reactionsCacheKey(messageId);
    const cached = await this.redisService.client.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as Record<string, string[]>;
    }

    const result = await this.cassandra.client.execute(
      `SELECT user_id, emoji FROM message_reactions WHERE message_id = ?`,
      [messageId],
      { prepare: true },
    );

    const summary: Record<string, string[]> = {};
    for (const row of result.rows) {
      const emoji = String(row.get('emoji'));
      const userId = String(row.get('user_id'));
      (summary[emoji] ??= []).push(userId);
    }

    await this.redisService.client.set(
      cacheKey,
      JSON.stringify(summary),
      'EX',
      REACTIONS_CACHE_TTL_SECONDS,
    );
    return summary;
  }

  private async assertMember(chatId: string, userId: string) {
    const isMember = await this.chatsClient.isMember(chatId, userId);
    if (!isMember) {
      throw new ForbiddenException('Вы не состоите в этом чате');
    }
  }

  private async invalidateAndNotify(
    chatId: string,
    messageId: string,
    userId: string,
    emoji: string,
    action: ReactionAction,
  ) {
    await this.redisService.client.del(this.reactionsCacheKey(messageId));

    const recipientIds = await this.chatsClient.getChatMembers(chatId);
    this.rabbitClient.emit('message.reaction', {
      chatId,
      messageId,
      userId,
      emoji,
      action,
      recipientIds,
    });
  }

  private reactionsCacheKey(messageId: string): string {
    return `reactions_cache:${messageId}`;
  }

  private async acquireLock(
    action: ReactionAction,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<boolean> {
    const lockKey = `reaction_lock:${action}:${messageId}:${userId}:${emoji}`;
    const acquired = await this.redisService.client.set(
      lockKey,
      '1',
      'EX',
      REACTION_LOCK_TTL_SECONDS,
      'NX',
    );
    return acquired !== null;
  }
}
