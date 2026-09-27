import { ApiProperty } from '@nestjs/swagger';

/** The caller's channel after an edit: never the id, user id or e-mail. */
export class ChannelResponseDto {
  @ApiProperty({ example: 'Meu Canal' })
  name: string;

  @ApiProperty({ example: 'meu_canal' })
  nickname: string;

  @ApiProperty({ type: String, nullable: true, example: 'Sobre o canal' })
  description: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;
}
