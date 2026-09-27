import type { VideoResponseDto } from './dto/video-response.dto';
import type { Video } from './entities/video.entity';

export function thumbnailUrlOf(publicId: string): string {
  return `/videos/${publicId}/thumbnail`;
}

/** The public representation of a video: never the internal id or keys. */
export function toVideoResponse(video: Video): VideoResponseDto {
  return {
    public_id: video.public_id,
    title: video.title,
    description: video.description,
    category: video.category
      ? { slug: video.category.slug, name: video.category.name }
      : null,
    status: video.status,
    visibility: video.visibility,
    published_at: video.published_at,
    thumbnail_url: thumbnailUrlOf(video.public_id),
    duration_seconds: video.duration_seconds,
    width: video.width,
    height: video.height,
    created_at: video.created_at,
    updated_at: video.updated_at,
  };
}
