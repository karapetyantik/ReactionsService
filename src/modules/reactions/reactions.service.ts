import { Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CassandraService } from 'src/common/cassandra/cassandra.service';
import { ChatsClientService } from '../chats-client/chats-client.service';
import { RedisService } from 'src/common/redis/redis.service';

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
    const lockKey = `reaction_lock:${messageId}:${userId}:${emoji}`;
    const acquired = await this.redisService.client.set(
      lockKey,
      '1',
      'EX',
      3,
      'NX',
    );
    if (!acquired) {
      return { chatId, messageId, userId, emoji, duplicate: true };
    }

    const isMember = await this.chatsClient.isMember(chatId, userId);
    if (!isMember) {
      throw new ForbiddenException('Вы не состоите в этом чате');
    }

    await this.cassandra.client.execute(
      `INSERT INTO message_reactions (message_id, user_id, chat_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)`,
      [messageId, userId, chatId, emoji, new Date()],
      { prepare: true },
    );

    await this.redisService.client.del(`reactions_cache:${messageId}`);

    const recipientIds = await this.chatsClient.getChatMembers(chatId);
    this.rabbitClient.emit('message.reaction', {
      chatId,
      messageId,
      userId,
      emoji,
      action: 'add',
      recipientIds,
    });

    return { chatId, messageId, userId, emoji };
  }

  async removeReaction(chatId: string, messageId: string, userId: string) {
    const isMember = await this.chatsClient.isMember(chatId, userId);
    if (!isMember) {
      throw new ForbiddenException('Вы не состоите в этом чате');
    }

    await this.cassandra.client.execute(
      `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?`,
      [messageId, userId],
      { prepare: true },
    );

    await this.redisService.client.del(`reactions_cache:${messageId}`);

    const recipientIds = await this.chatsClient.getChatMembers(chatId);
    this.rabbitClient.emit('message.reaction', {
      chatId,
      messageId,
      userId,
      action: 'remove',
      recipientIds,
    });

    return { chatId, messageId, userId };
  }

  async getReactions(messageId: string) {
    const cacheKey = `reactions_cache:${messageId}`;
    const cached = await this.redisService.client.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const result = await this.cassandra.client.execute(
      `SELECT user_id, emoji FROM message_reactions WHERE message_id = ?`,
      [messageId],
      { prepare: true },
    );

    const summary: Record<string, string[]> = {};
    for (const row of result.rows) {
      if (!summary[row.emoji]) summary[row.emoji] = [];
      summary[row.emoji].push(row.user_id.toString());
    }

    await this.redisService.client.set(
      cacheKey,
      JSON.stringify(summary),
      'EX',
      60,
    );
    return summary;
  }
}
