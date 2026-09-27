import { ApiProperty } from '@nestjs/swagger';

/** The public page of a channel: never the id, user id or e-mail. */
export class PublicChannelResponseDto {
  @ApiProperty({ example: 'Meu Canal' })
  name: string;

  @ApiProperty({ example: 'meu_canal' })
  nickname: string;

  @ApiProperty({ type: String, nullable: true, example: 'Sobre o canal' })
  description: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ example: 12, description: 'Published public videos only' })
  video_count: number;
}
