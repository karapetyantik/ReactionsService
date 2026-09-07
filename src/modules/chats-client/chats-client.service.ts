import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, Observable } from 'rxjs';
import type { Metadata } from '@grpc/grpc-js';
import { buildInternalGrpcMetadata } from './internal-grpc-metadata';

interface ChatInternalGrpcService {
  getChatMembers(
    data: { chatId: string },
    metadata?: Metadata,
  ): Observable<{ memberIds: string[] }>;
  isMember(
    data: { chatId: string; userId: string },
    metadata?: Metadata,
  ): Observable<{ isMember: boolean }>;
}

@Injectable()
export class ChatsClientService implements OnModuleInit {
  private grpcService!: ChatInternalGrpcService;

  constructor(
    @Inject('CHAT_GRPC_SERVICE') private readonly client: ClientGrpc,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.grpcService =
      this.client.getService<ChatInternalGrpcService>('ChatInternal');
  }

  async getChatMembers(chatId: string): Promise<string[]> {
    const result = await firstValueFrom(
      this.grpcService.getChatMembers({ chatId }, this.metadata()),
    );
    return result.memberIds;
  }

  async isMember(chatId: string, userId: string): Promise<boolean> {
    const result = await firstValueFrom(
      this.grpcService.isMember({ chatId, userId }, this.metadata()),
    );
    return result.isMember;
  }

  private metadata() {
    return buildInternalGrpcMetadata(
      this.config.getOrThrow<string>('INTERNAL_API_KEY'),
    );
  }
}
