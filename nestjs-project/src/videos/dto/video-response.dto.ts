import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from '../../categories/dto/category-response.dto';
import { VideoStatus } from '../video-status.enum';
import { VideoVisibility } from '../video-visibility.enum';

export class VideoResponseDto {
  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  public_id: string;

  @ApiProperty({ example: 'Holiday in Lisbon' })
  title: string;

  @ApiProperty({ type: String, nullable: true, example: 'Plain text' })
  description: string | null;

  @ApiProperty({ type: CategoryResponseDto, nullable: true })
  category: CategoryResponseDto | null;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.READY })
  status: VideoStatus;

  @ApiProperty({ enum: VideoVisibility, example: VideoVisibility.PUBLIC })
  visibility: VideoVisibility;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Null while the video is an editorial draft',
  })
  published_at: Date | null;

  @ApiProperty({ example: '/videos/dQw4w9WgXcQ/thumbnail' })
  thumbnail_url: string;

  @ApiProperty({ type: Number, nullable: true, example: 12.5 })
  duration_seconds: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1920 })
  width: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1080 })
  height: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}
