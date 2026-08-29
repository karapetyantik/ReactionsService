import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ReactionDto {
  @IsUUID()
  chatId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8)
  emoji!: string;
}
