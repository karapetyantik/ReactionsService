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
import { JwtAuthGuard } from '@common/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@common/auth/authenticated-request.interface';
import { ReactionsService } from './reactions.service';
import { ReactionDto } from './dto/reaction.dto';
import { RemoveReactionDto } from './dto/remove-reaction.dto';

@UseGuards(JwtAuthGuard)
@Controller('messages/:messageId/reactions')
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  @Post()
  add(
    @Req() req: AuthenticatedRequest,
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
    @Req() req: AuthenticatedRequest,
    @Param('messageId') messageId: string,
    @Body() dto: RemoveReactionDto,
  ) {
    return this.reactionsService.removeReaction(
      dto.chatId,
      messageId,
      req.user.userId,
      dto.emoji,
    );
  }

  @Get()
  list(@Param('messageId') messageId: string) {
    return this.reactionsService.getReactions(messageId);
  }
}
