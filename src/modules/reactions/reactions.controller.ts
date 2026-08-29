import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/auth/jwt-auth.guard';
import { ReactionsService } from './reactions.service';
import { ReactionDto } from './dto/reaction.dto';

@UseGuards(JwtAuthGuard)
@Controller('messages/:messageId/reactions')
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  @Post()
  add(
    @Req() req: any,
    @Param('messageId') messageId: string,
    @Body() dto: ReactionDto,
  ) {
    return this.reactionsService.addReaction(
      dto.chatId,
      messageId,
      req.user.userId,
      dto.emoji,
    );
  }

  @Delete()
  remove(
    @Req() req: any,
    @Param('messageId') messageId: string,
    @Body('chatId') chatId: string,
  ) {
    return this.reactionsService.removeReaction(
      chatId,
      messageId,
      req.user.userId,
    );
  }

  @Get()
  list(@Param('messageId') messageId: string) {
    return this.reactionsService.getReactions(messageId);
  }
}
