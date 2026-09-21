import { Injectable } from '@nestjs/common';
import {
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import type { VideoResponseDto } from './dto/video-response.dto';
import type { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideosRepository } from './videos.repository';

@Injectable()
export class VideosService {
  constructor(private readonly videosRepository: VideosRepository) {}

  /**
   * Public read: until Phase 04 adds publication, any `ready` video is
   * reachable by whoever has its `public_id`.
   */
  async getReadyVideo(publicId: string): Promise<VideoResponseDto> {
    const video = await this.videosRepository.findByPublicId(publicId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }
    return this.toResponse(video);
  }

  private toResponse(video: Video): VideoResponseDto {
    return {
      public_id: video.public_id,
      title: video.title,
      status: video.status,
      duration_seconds: video.duration_seconds,
      width: video.width,
      height: video.height,
      created_at: video.created_at,
    };
  }
}
