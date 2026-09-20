import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import videoConfig from '../config/video.config';
import { QUEUE_NAMES } from '../queue/queue.constants';
import type { VideoProcessingJobData } from '../queue/queue.types';
import { StorageService } from '../storage/storage.service';
import type { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/video-status.enum';
import { VideosRepository } from '../videos/videos.repository';
import { MediaProbeService } from './media/media-probe.service';
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
        `Video ${videoId} left processing while the job was running; result discarded`,
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
