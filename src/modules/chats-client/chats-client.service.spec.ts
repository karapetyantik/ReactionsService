import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { ChatsClientService } from './chats-client.service';

describe('ChatsClientService', () => {
  let service: ChatsClientService;
  const grpcService = {
    getChatMembers: jest.fn(),
    isMember: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatsClientService,
        {
          provide: 'CHAT_GRPC_SERVICE',
          useValue: { getService: jest.fn().mockReturnValue(grpcService) },
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('test-key') },
        },
      ],
    }).compile();

    service = module.get(ChatsClientService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('unwraps the member id list from the gRPC response', async () => {
    grpcService.getChatMembers.mockReturnValue(of({ memberIds: ['u1', 'u2'] }));

    await expect(service.getChatMembers('chat1')).resolves.toEqual([
      'u1',
      'u2',
    ]);
  });

  it('unwraps the membership flag from the gRPC response', async () => {
    grpcService.isMember.mockReturnValue(of({ isMember: true }));

    await expect(service.isMember('chat1', 'u1')).resolves.toBe(true);
  });
});
