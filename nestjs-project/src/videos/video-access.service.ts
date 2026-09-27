import { Injectable } from '@nestjs/common';
import {
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import type { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideosRepository } from './videos.repository';

/**
 * Read access to a video (metadata, stream, download, thumbnail), Phase 04:
 * a published video is readable by anyone; a draft only by the owner of its
 * channel. The order matters: first a draft read by anyone else is not found
 * (404), and only then a video that is not `ready` is a conflict (409), which
 * in practice only the owner reaches.
 */
@Injectable()
export class VideoAccessService {
  constructor(private readonly videosRepository: VideosRepository) {}

  async loadReadable(
    publicId: string,
    viewerUserId: string | undefined,
  ): Promise<Video> {
    const video =
      await this.videosRepository.findByPublicIdWithRelations(publicId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    const isOwner =
      viewerUserId !== undefined && video.channel.user_id === viewerUserId;
    if (video.published_at === null && !isOwner) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }
    return video;
  }
}
