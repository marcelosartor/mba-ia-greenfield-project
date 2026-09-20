import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import videoConfig from '../config/video.config';
import { JOB_NAMES, QUEUE_NAMES } from '../queue/queue.constants';
import type {
  DeadLetteredVideoJobData,
  VideoProcessingJobData,
} from '../queue/queue.types';
import { StorageService } from '../storage/storage.service';
import type { Video } from '../videos/entities/video.entity';
import {
  MAX_ERROR_MESSAGE_LENGTH,
  VIDEO_ERROR_CODES,
} from '../videos/video-error-codes';
import { VideoStatus } from '../videos/video-status.enum';
import { VideosRepository } from '../videos/videos.repository';
import { redactUrls } from './media/media-tool';
import { MediaProbeService } from './media/media-probe.service';
import { InvalidMediaError } from './media/media.errors';
import type { MediaMetadata } from './media/media.types';
import { ThumbnailService } from './media/thumbnail.service';

const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';
// Headroom on top of the processing timeout so the presigned URL never
// expires while ffprobe/ffmpeg are still reading.
const SOURCE_URL_MARGIN_SECONDS = 60;

export function thumbnailKeyFor(videoId: string): string {
  return `${videoId}/default.jpg`;
}

@Processor(QUEUE_NAMES.VIDEO_PROCESSING)
export class VideoProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
    private readonly mediaProbeService: MediaProbeService,
    private readonly thumbnailService: ThumbnailService,
    @InjectQueue(QUEUE_NAMES.VIDEO_PROCESSING_DLQ)
    private readonly deadLetterQueue: Queue<DeadLetteredVideoJobData>,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {
    super();
  }

  // The concurrency comes from configuration, which a decorator argument
  // cannot read; the worker already exists once the application bootstraps.
  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.workerConcurrency;
  }

  /**
   * Any error thrown here makes BullMQ retry the job (`attempts` + backoff);
   * that is what transient failures (storage, network, database) rely on, so
   * they are deliberately not caught. Only an invalid file is handled: it ends
   * the video in `error` and is raised as an `UnrecoverableError`, which skips
   * the remaining attempts.
   */
  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    const { videoId } = job.data;

    const video = await this.videosRepository.findById(videoId);
    if (!video) {
      this.logger.warn(`Video ${videoId} does not exist; job skipped`);
      return;
    }
    if (!(await this.videosRepository.startProcessing(videoId))) {
      this.logger.log(
        `Video ${videoId} is not waiting for processing (status ${video.status}); job skipped`,
      );
      return;
    }

    try {
      await this.processVideo(video);
    } catch (error) {
      if (error instanceof InvalidMediaError) {
        await this.failVideo(
          videoId,
          [VideoStatus.PROCESSING],
          VIDEO_ERROR_CODES.INVALID_MEDIA,
          error.message,
        );
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  /**
   * Runs after every failed attempt. Once the attempts are exhausted by
   * transient failures, the job is copied to the dead-letter queue and the
   * video ends in `error`. This is an event handler, not part of the request
   * lifecycle: an exception escaping it would be an unhandled rejection that
   * kills the worker, so failures here are logged instead of rethrown.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<VideoProcessingJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job || !this.isExhausted(job, error)) {
      return;
    }
    const { videoId } = job.data;
    const failedReason = this.shortMessage(error.message);

    try {
      await this.failVideo(
        videoId,
        [VideoStatus.PROCESSING, VideoStatus.DRAFT],
        VIDEO_ERROR_CODES.PROCESSING_FAILED,
        failedReason,
      );
      await this.deadLetterQueue.add(JOB_NAMES.DEAD_LETTERED_VIDEO, {
        videoId,
        failedReason,
        attemptsMade: job.attemptsMade,
      });
    } catch (handlerError) {
      this.logger.error(
        `Could not dead-letter video ${videoId}: ${String(handlerError)}`,
      );
    }
  }

  // An UnrecoverableError already ended the video in `process`; every other
  // failure is final only when it consumed the last attempt.
  private isExhausted(job: Job, error: Error): boolean {
    return (
      !(error instanceof UnrecoverableError) &&
      job.attemptsMade >= (job.opts.attempts ?? 1)
    );
  }

  private async failVideo(
    videoId: string,
    from: VideoStatus[],
    errorCode: string,
    message: string,
  ): Promise<void> {
    const changed = await this.videosRepository.transitionStatus(
      videoId,
      from,
      VideoStatus.ERROR,
      { error_code: errorCode, error_message: this.shortMessage(message) },
    );
    if (!changed) {
      this.logger.warn(
        `Video ${videoId} was no longer in ${from.join('/')}; error ${errorCode} not recorded`,
      );
    }
  }

  // Stored and logged: keeps it short and never lets a presigned URL through.
  private shortMessage(message: string): string {
    return redactUrls(message).slice(0, MAX_ERROR_MESSAGE_LENGTH);
  }

  private async processVideo(video: Video): Promise<void> {
    const sourceUrl = await this.storageService.presignGetObject(
      this.storageService.videosBucket,
      video.video_key,
      Math.ceil(this.config.processingTimeoutMs / 1000) +
        SOURCE_URL_MARGIN_SECONDS,
    );
    const media = await this.mediaProbeService.probe(sourceUrl);
    const thumbnailKey = await this.storeThumbnail(video, sourceUrl, media);

    const finished = await this.videosRepository.transitionStatus(
      video.id,
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      {
        duration_seconds: media.duration_seconds,
        width: media.width,
        height: media.height,
        video_codec: media.video_codec,
        audio_codec: media.audio_codec,
        bit_rate: media.bit_rate,
        format_name: media.format_name,
        size_bytes: media.size_bytes,
        // TypeORM's deep-partial type does not accept an open JSON object
        metadata: media.metadata as QueryDeepPartialEntity<Video>['metadata'],
        thumbnail_key: thumbnailKey,
        error_code: null,
        error_message: null,
      },
    );
    if (!finished) {
      this.logger.warn(
        `Video ${video.id} left processing while the job was running; result discarded`,
      );
    }
  }

  private async storeThumbnail(
    video: Video,
    sourceUrl: string,
    media: MediaMetadata,
  ): Promise<string> {
    const image = await this.thumbnailService.generate(
      sourceUrl,
      media.duration_seconds,
    );
    // Deterministic key: a retry or redelivery overwrites the same object.
    const key = thumbnailKeyFor(video.id);
    await this.storageService.putObject(
      this.storageService.thumbnailsBucket,
      key,
      image,
      THUMBNAIL_CONTENT_TYPE,
    );
    return key;
  }
}
