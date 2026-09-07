import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ReactionsService } from './reactions.service';
import { CassandraService } from '@common/cassandra/cassandra.service';
import { RedisService } from '@common/redis/redis.service';
import { ChatsClientService } from '../chats-client/chats-client.service';

describe('ReactionsService', () => {
  let service: ReactionsService;
  let cassandra: { client: { execute: jest.Mock } };
  let redisStore: Map<string, string>;
  let chatsClient: { isMember: jest.Mock; getChatMembers: jest.Mock };
  let rabbitClient: { emit: jest.Mock };

  beforeEach(async () => {
    redisStore = new Map();
    cassandra = { client: { execute: jest.fn().mockResolvedValue({}) } };
    chatsClient = {
      isMember: jest.fn().mockResolvedValue(true),
      getChatMembers: jest.fn().mockResolvedValue([]),
    };
    rabbitClient = { emit: jest.fn() };

    const redisClientMock = {
      get: jest.fn((key: string) =>
        Promise.resolve(redisStore.get(key) ?? null),
      ),
      set: jest.fn((key: string, ...rest: unknown[]) => {
        const nx = rest.includes('NX');
        if (nx && redisStore.has(key)) return Promise.resolve(null);
        redisStore.set(key, '1');
        return Promise.resolve('OK');
      }),
      del: jest.fn((key: string) => {
        redisStore.delete(key);
        return Promise.resolve(1);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReactionsService,
        { provide: CassandraService, useValue: cassandra },
        { provide: ChatsClientService, useValue: chatsClient },
        { provide: RedisService, useValue: { client: redisClientMock } },
        { provide: 'RABBITMQ_SERVICE', useValue: rabbitClient },
      ],
    }).compile();

    service = module.get(ReactionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('deletes only the targeted emoji, not every reaction the user left', async () => {
    await service.removeReaction('chat1', 'msg1', 'user1', '👍');

    expect(cassandra.client.execute).toHaveBeenCalledWith(
      expect.stringContaining('emoji = ?'),
      ['msg1', 'user1', '👍'],
      { prepare: true },
    );
  });

  it('rejects add/remove when the caller is not a chat member', async () => {
    chatsClient.isMember.mockResolvedValue(false);

    await expect(
      service.addReaction('chat1', 'msg1', 'user1', '👍'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.removeReaction('chat1', 'msg1', 'user1', '👍'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('debounces a rapid duplicate add for the same emoji', async () => {
    const first = await service.addReaction('chat1', 'msg1', 'user1', '👍');
    const second = await service.addReaction('chat1', 'msg1', 'user1', '👍');

    expect(first).not.toHaveProperty('duplicate');
    expect(second).toMatchObject({ duplicate: true });
    expect(cassandra.client.execute).toHaveBeenCalledTimes(1);
  });

  it('does not let a debounced add block a remove of the same emoji', async () => {
    await service.addReaction('chat1', 'msg1', 'user1', '👍');
    const removed = await service.removeReaction(
      'chat1',
      'msg1',
      'user1',
      '👍',
    );

    expect(removed).not.toHaveProperty('duplicate');
  });
});
