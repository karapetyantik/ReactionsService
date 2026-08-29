import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable } from 'rxjs';

interface ChatInternalGrpcService {
  getChatMembers(data: { chatId: string }): Observable<{ memberIds: string[] }>;
  isMember(data: {
    chatId: string;
    userId: string;
  }): Observable<{ isMember: boolean }>;
}

@Injectable()
export class ChatsClientService implements OnModuleInit {
  private grpcService!: ChatInternalGrpcService;

  constructor(
    @Inject('CHAT_GRPC_SERVICE') private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.grpcService =
      this.client.getService<ChatInternalGrpcService>('ChatInternal');
  }

  async getChatMembers(chatId: string): Promise<string[]> {
    const result = await firstValueFrom(
      this.grpcService.getChatMembers({ chatId }),
    );
    return result.memberIds;
  }

  async isMember(chatId: string, userId: string): Promise<boolean> {
    const result = await firstValueFrom(
      this.grpcService.isMember({ chatId, userId }),
    );
    return result.isMember;
  }
}
