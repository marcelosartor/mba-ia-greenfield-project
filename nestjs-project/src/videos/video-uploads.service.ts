import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  UnsupportedVideoFormatException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import { CreateVideoDto } from './dto/create-video.dto';
import {
  MAX_VIDEO_SIZE_BYTES,
  MAX_VIDEO_TITLE_LENGTH,
  VIDEO_FORMATS,
} from './video-upload.constants';
import { VideosRepository } from './videos.repository';
import type { InitiatedUpload } from './videos.types';

const DEFAULT_TITLE = 'Untitled video';

// Split on the last dot so that a name such as ".mp4" still has an extension.
function splitFilename(filename: string): { base: string; extension: string } {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) {
    return { base: filename, extension: '' };
  }
  return {
    base: filename.slice(0, dot),
    extension: filename.slice(dot + 1).toLowerCase(),
  };
}

@Injectable()
export class VideoUploadsService {
  private readonly logger = new Logger(VideoUploadsService.name);

  constructor(
    private readonly channelsService: ChannelsService,
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async initiate(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<InitiatedUpload> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const extension = this.resolveExtension(dto);
    if (dto.size_bytes > MAX_VIDEO_SIZE_BYTES) {
      throw new VideoTooLargeException();
    }

    const draft = await this.videosRepository.createDraft({
      channelId: channel.id,
      title: this.deriveTitle(dto.filename),
      extension,
    });

    let uploadId: string | undefined;
    try {
      uploadId = await this.storageService.createMultipartUpload(
        draft.video_key,
        dto.content_type,
      );
      await this.videosRepository.setUploadId(draft.id, uploadId);
    } catch (error) {
      await this.discardDraft(draft.id, draft.video_key, uploadId);
      throw error;
    }

    return {
      public_id: draft.public_id,
      status: draft.status,
      part_size_bytes: this.config.partSizeBytes,
      part_count: Math.ceil(dto.size_bytes / this.config.partSizeBytes),
    };
  }

  private resolveExtension(dto: CreateVideoDto): string {
    const { extension } = splitFilename(dto.filename);
    const expectedContentType = (
      VIDEO_FORMATS as Record<string, string | undefined>
    )[extension];
    if (
      expectedContentType === undefined ||
      expectedContentType !== dto.content_type.toLowerCase()
    ) {
      throw new UnsupportedVideoFormatException();
    }
    return extension;
  }

  private deriveTitle(filename: string): string {
    const title = splitFilename(filename)
      .base.trim()
      .slice(0, MAX_VIDEO_TITLE_LENGTH);
    return title || DEFAULT_TITLE;
  }

  /**
   * Compensation for a failed initiation: the caller rethrows the original
   * error, so a failure of the cleanup itself is only logged (an orphan draft
   * or multipart is left for the abandoned-upload sweeper).
   */
  private async discardDraft(
    videoId: string,
    videoKey: string,
    uploadId: string | undefined,
  ): Promise<void> {
    try {
      if (uploadId) {
        await this.storageService.abortMultipartUpload(videoKey, uploadId);
      }
    } catch (cleanupError) {
      this.logger.warn(
        `Could not abort multipart upload of video ${videoId}: ${String(cleanupError)}`,
      );
    }
    await this.videosRepository.deleteById(videoId);
  }
}
