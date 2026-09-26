import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  UnsupportedVideoFormatException,
  UploadAlreadyCompletedException,
  InvalidPartNumberException,
  UploadIncompleteException,
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { VideoProcessingPublisher } from '../queue/video-processing.publisher';
import { StorageService } from '../storage/storage.service';
import type { StorageUploadedPart } from '../storage/storage.types';
import { CreateVideoDto } from './dto/create-video.dto';
import type { RequestUploadPartsDto } from './dto/request-upload-parts.dto';
import type { UploadCompletionResponseDto } from './dto/upload-completion-response.dto';
import type { UploadPartsResponseDto } from './dto/upload-parts-response.dto';
import type { UploadSessionResponseDto } from './dto/upload-session-response.dto';
import type { Video } from './entities/video.entity';
import {
  MAX_VIDEO_SIZE_BYTES,
  MAX_VIDEO_TITLE_LENGTH,
  UPLOAD_URL_EXPIRATION_SECONDS,
  VIDEO_FORMATS,
} from './video-upload.constants';
import { expectedPartLength, partCountFor } from './upload-parts.util';
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
    private readonly videoProcessingPublisher: VideoProcessingPublisher,
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
      declaredSizeBytes: dto.size_bytes,
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
      part_count: partCountFor(dto.size_bytes, this.config.partSizeBytes),
    };
  }

  async getUploadSession(
    userId: string,
    publicId: string,
  ): Promise<UploadSessionResponseDto> {
    const video = await this.loadOwnedVideo(userId, publicId);

    const uploadCompleted = video.upload_completed_at !== null;
    const parts =
      uploadCompleted || !video.upload_id
        ? []
        : await this.storageService.listParts(video.video_key, video.upload_id);

    return {
      public_id: video.public_id,
      status: video.status,
      upload_completed: uploadCompleted,
      part_size_bytes: this.config.partSizeBytes,
      uploaded_parts: parts.map((part) => ({
        part_number: part.partNumber,
        size_bytes: part.sizeBytes,
      })),
    };
  }

  async requestPartUrls(
    userId: string,
    publicId: string,
    dto: RequestUploadPartsDto,
  ): Promise<UploadPartsResponseDto> {
    const video = await this.loadOwnedVideo(userId, publicId);
    if (video.upload_completed_at !== null) {
      throw new UploadAlreadyCompletedException();
    }
    const uploadId = video.upload_id;
    if (!uploadId) {
      throw new Error(`Video ${video.id} has no open multipart upload`);
    }

    // The declared size fixes how many parts exist and how long each one is;
    // signing that length keeps the storage from accepting more than declared.
    // Only drafts created before the size was recorded have no such bound.
    const declared = video.declared_size_bytes;
    const partSize = this.config.partSizeBytes;
    if (
      declared !== null &&
      dto.part_numbers.some((n) => n > partCountFor(declared, partSize))
    ) {
      throw new InvalidPartNumberException();
    }

    const parts = await Promise.all(
      dto.part_numbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await this.storageService.presignUploadPart(
          video.video_key,
          uploadId,
          partNumber,
          UPLOAD_URL_EXPIRATION_SECONDS,
          declared === null
            ? undefined
            : expectedPartLength(declared, partSize, partNumber),
        ),
      })),
    );

    return { parts, expires_in: UPLOAD_URL_EXPIRATION_SECONDS };
  }

  /**
   * Confirms the end of the upload. Idempotent: once `upload_completed_at` is
   * set, repeating the call returns the same answer without completing the
   * multipart again or publishing another job.
   */
  async completeUpload(
    userId: string,
    publicId: string,
  ): Promise<UploadCompletionResponseDto> {
    const video = await this.loadOwnedVideo(userId, publicId);
    if (video.upload_completed_at !== null) {
      return this.toCompletionResponse(video);
    }
    const uploadId = video.upload_id;
    if (!uploadId) {
      throw new Error(`Video ${video.id} has no open multipart upload`);
    }

    try {
      const parts = await this.validateParts(
        video,
        uploadId,
        await this.storageService.listParts(video.video_key, uploadId),
      );
      await this.storageService.completeMultipartUpload(
        video.video_key,
        uploadId,
        parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
      );
    } catch (error) {
      // A concurrent confirmation of the same upload already completed the
      // multipart; the storage no longer knows this upload id.
      if (
        (error as { name?: string }).name === 'NoSuchUpload' &&
        (await this.wasCompletedMeanwhile(publicId))
      ) {
        return this.toCompletionResponse(video);
      }
      throw error;
    }

    const marked = await this.videosRepository.markUploadCompleted(video.id);
    if (marked) {
      await this.publishProcessingJob(video.id);
    }

    return this.toCompletionResponse(video);
  }

  /** Owner = the user whose channel owns the video (channels.user_id = sub). */
  async assertOwner(userId: string, video: Video): Promise<void> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || channel.id !== video.channel_id) {
      throw new VideoAccessDeniedException();
    }
  }

  /**
   * Sequence 1..N, every part but the last with exactly `part_size_bytes`, and
   * a total within the size limit. Over the limit the multipart is aborted and
   * the draft removed.
   */
  private async validateParts(
    video: Video,
    uploadId: string,
    parts: StorageUploadedPart[],
  ): Promise<StorageUploadedPart[]> {
    const totalBytes = parts.reduce((sum, part) => sum + part.sizeBytes, 0);
    if (totalBytes > MAX_VIDEO_SIZE_BYTES) {
      await this.discardDraft(video.id, video.video_key, uploadId);
      throw new VideoTooLargeException();
    }

    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const lastIndex = sorted.length - 1;
    // What was declared must be what arrived: as many parts as the size needs
    // and exactly that many bytes (a missing last part would otherwise
    // complete a truncated file). Drafts without a declared size keep the
    // sequence check only.
    const declared = video.declared_size_bytes;
    const matchesDeclared =
      declared === null ||
      (sorted.length === partCountFor(declared, this.config.partSizeBytes) &&
        totalBytes === declared);
    const valid =
      sorted.length > 0 &&
      matchesDeclared &&
      sorted.every(
        (part, index) =>
          part.partNumber === index + 1 &&
          (index === lastIndex || part.sizeBytes === this.config.partSizeBytes),
      );
    if (!valid) {
      throw new UploadIncompleteException();
    }
    return sorted;
  }

  private async wasCompletedMeanwhile(publicId: string): Promise<boolean> {
    const current = await this.videosRepository.findByPublicId(publicId);
    return current !== null && current.upload_completed_at !== null;
  }

  /**
   * The job is published only after the completion is stored. A failure here
   * must not undo the completion: it is logged and the sweeper republishes
   * the job for videos whose upload is complete but never left `draft`.
   */
  private async publishProcessingJob(videoId: string): Promise<void> {
    try {
      await this.videoProcessingPublisher.publish(videoId);
    } catch (error) {
      this.logger.error(
        `Could not publish the processing job of video ${videoId}: ${String(error)}`,
      );
    }
  }

  private toCompletionResponse(video: Video): UploadCompletionResponseDto {
    return {
      public_id: video.public_id,
      status: video.status,
      upload_completed: true,
    };
  }

  private async loadOwnedVideo(
    userId: string,
    publicId: string,
  ): Promise<Video> {
    const video = await this.videosRepository.findByPublicId(publicId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    await this.assertOwner(userId, video);
    return video;
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
