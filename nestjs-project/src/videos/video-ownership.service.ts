import { Injectable } from '@nestjs/common';
import { ChannelsService } from '../channels/channels.service';
import {
  VideoAccessDeniedException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import type { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';

/**
 * Write access to a video: only the owner, i.e. the user whose channel owns
 * it (channels.user_id = sub). Shared by the upload and by every edit of
 * Phase 04 (metadata, publication, thumbnail).
 */
@Injectable()
export class VideoOwnershipService {
  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly channelsService: ChannelsService,
  ) {}

  /**
   * @throws VideoNotFoundException when the public_id does not exist.
   * @throws VideoAccessDeniedException when the video is another channel's.
   */
  async loadOwned(userId: string, publicId: string): Promise<Video> {
    const video = await this.videosRepository.findByPublicId(publicId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || channel.id !== video.channel_id) {
      throw new VideoAccessDeniedException();
    }
    return video;
  }
}
