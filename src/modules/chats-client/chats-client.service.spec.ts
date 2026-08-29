import { Test, TestingModule } from '@nestjs/testing';
import { ChatsClientService } from './chats-client.service';

describe('ChatsClientService', () => {
  let service: ChatsClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChatsClientService],
    }).compile();

    service = module.get<ChatsClientService>(ChatsClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
