import { Injectable, Logger } from '@nestjs/common';
import { VideoProcessingPublisher } from '../queue/video-processing.publisher';
import { StorageService } from '../storage/storage.service';
import type { Video } from '../videos/entities/video.entity';
import { VideosRepository } from '../videos/videos.repository';
import {
  ABANDONED_UPLOAD_AGE_MS,
  COMPLETED_UPLOAD_GRACE_MS,
  SWEEP_BATCH_SIZE,
} from './uploads-sweeper.constants';

export interface SweepResult {
  abandonedRemoved: number;
  jobsRepublished: number;
}

@Injectable()
export class UploadsSweeperService {
  private readonly logger = new Logger(UploadsSweeperService.name);

  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
    private readonly publisher: VideoProcessingPublisher,
  ) {}

  /**
   * Runs as a scheduled job, so one bad video must not stop the others nor
   * fail the run: each failure is logged and the video is retried on the next
   * run. Both steps are idempotent.
   */
  async run(now: Date = new Date()): Promise<SweepResult> {
    return {
      abandonedRemoved: await this.removeAbandonedUploads(now),
      jobsRepublished: await this.republishCompletedUploads(now),
    };
  }

  private async removeAbandonedUploads(now: Date): Promise<number> {
    const drafts = await this.videosRepository.findAbandonedDrafts(
      new Date(now.getTime() - ABANDONED_UPLOAD_AGE_MS),
      SWEEP_BATCH_SIZE,
    );

    let removed = 0;
    for (const draft of drafts) {
      try {
        await this.abortMultipart(draft);
        if (await this.videosRepository.deleteAbandonedDraft(draft.id)) {
          removed++;
        }
      } catch (error) {
        this.logger.error(
          `Could not remove abandoned draft ${draft.id}: ${String(error)}`,
        );
      }
    }
    return removed;
  }

  // The multipart may already be gone (aborted before, or completed while the
  // sweeper was running): the storage answers NoSuchUpload, which is fine.
  private async abortMultipart(draft: Video): Promise<void> {
    if (!draft.upload_id) {
      return;
    }
    try {
      await this.storageService.abortMultipartUpload(
        draft.video_key,
        draft.upload_id,
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'NoSuchUpload') {
        throw error;
      }
    }
  }

  private async republishCompletedUploads(now: Date): Promise<number> {
    const videos = await this.videosRepository.findCompletedAwaitingWorker(
      new Date(now.getTime() - COMPLETED_UPLOAD_GRACE_MS),
      SWEEP_BATCH_SIZE,
    );

    let republished = 0;
    for (const video of videos) {
      try {
        await this.publisher.republish(video.id);
        republished++;
      } catch (error) {
        this.logger.error(
          `Could not republish the job of video ${video.id}: ${String(error)}`,
        );
      }
    }
    return republished;
  }
}
