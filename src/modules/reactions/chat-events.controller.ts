import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { RedisService } from '@common/redis/redis.service';

interface ChatMembersChangedEvent {
  chatId: string;
}

@Controller()
export class ChatEventsController {
  private readonly logger = new Logger(ChatEventsController.name);

  constructor(private readonly redisService: RedisService) {}

  @EventPattern('chat.members.changed')
  async handleMembersChanged(@Payload() event: ChatMembersChangedEvent) {
    await this.redisService.client.del(`chat_members:${event.chatId}`);
    this.logger.debug(`Кэш участников инвалидирован для chatId=${event.chatId}`);
  }
}
