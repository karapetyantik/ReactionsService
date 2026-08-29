import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { ChatsClientService } from './chats-client.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'CHAT_GRPC_SERVICE',
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'chat',
            protoPath: join(__dirname, '../proto/chat.proto'),
            url: config.getOrThrow<string>('CHAT_SERVICE_GRPC_URL'),
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [ChatsClientService],
  exports: [ChatsClientService],
})
export class ChatsClientModule {}
