import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from '../../../categories/dto/category-response.dto';
import { VideoStatus } from '../../video-status.enum';
import { VideoVisibility } from '../../video-visibility.enum';

/** An item of the owner's panel (GET /channels/me/videos). */
export class PanelVideoItemDto {
  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  public_id: string;

  @ApiProperty({ example: 'Holiday in Lisbon' })
  title: string;

  @ApiProperty({ example: '/videos/dQw4w9WgXcQ/thumbnail' })
  thumbnail_url: string;

  @ApiProperty({ type: CategoryResponseDto, nullable: true })
  category: CategoryResponseDto | null;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiProperty({ enum: VideoVisibility })
  visibility: VideoVisibility;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  published_at: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ example: 0, description: 'Always 0 until Phase 05' })
  views: number;

  @ApiProperty({ example: 0, description: 'Always 0 until Phase 06' })
  likes: number;

  @ApiProperty({ example: 0, description: 'Always 0 until Phase 06' })
  comments: number;
}
