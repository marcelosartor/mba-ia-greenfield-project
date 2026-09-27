import { ApiProperty } from '@nestjs/swagger';

/** An item of the public channel page (GET /channels/{nickname}/videos). */
export class PublicVideoItemDto {
  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  public_id: string;

  @ApiProperty({ example: 'Holiday in Lisbon' })
  title: string;

  @ApiProperty({ example: '/videos/dQw4w9WgXcQ/thumbnail' })
  thumbnail_url: string;

  @ApiProperty({ type: Number, nullable: true, example: 12.5 })
  duration_seconds: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  published_at: Date;
}
