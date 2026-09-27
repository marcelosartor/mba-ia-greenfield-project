import { Injectable } from '@nestjs/common';
import { VideoNotPublishableException } from '../common/exceptions/domain.exception';
import type { VideoResponseDto } from './dto/video-response.dto';
import { VideoOwnershipService } from './video-ownership.service';
import { toVideoResponse } from './video-response.mapper';
import { VideoVisibility } from './video-visibility.enum';
import { VideosRepository } from './videos.repository';

/** Draft → publication flow (Phase 04, TD-01), owner only. */
@Injectable()
export class VideoPublicationService {
  constructor(
    private readonly videoOwnershipService: VideoOwnershipService,
    private readonly videosRepository: VideosRepository,
  ) {}

  /**
   * Publishes a `ready` video; every call writes `published_at = now()`.
   * @throws VideoNotPublishableException when the video is not `ready`.
   */
  async publish(
    userId: string,
    publicId: string,
    visibility: VideoVisibility = VideoVisibility.PUBLIC,
  ): Promise<VideoResponseDto> {
    const video = await this.videoOwnershipService.loadOwned(userId, publicId);
    const published = await this.videosRepository.publish(video.id, visibility);
    if (!published) {
      throw new VideoNotPublishableException();
    }
    const updated =
      await this.videosRepository.findByPublicIdWithRelations(publicId);
    return toVideoResponse(updated!);
  }

  /** Back to draft; idempotent, the visibility is kept. */
  async unpublish(userId: string, publicId: string): Promise<void> {
    const video = await this.videoOwnershipService.loadOwned(userId, publicId);
    await this.videosRepository.unpublish(video.id);
  }
}
