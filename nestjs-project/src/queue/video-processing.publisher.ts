import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from './queue.constants';
import type { VideoProcessingJobData } from './queue.types';

@Injectable()
export class VideoProcessingPublisher {
  constructor(
    @InjectQueue(QUEUE_NAMES.VIDEO_PROCESSING)
    private readonly queue: Queue<VideoProcessingJobData>,
  ) {}

  /**
   * The job id is the video id, so publishing the same video again while the
   * job still exists does not create a second job.
   */
  async publish(videoId: string): Promise<void> {
    await this.queue.add(
      JOB_NAMES.PROCESS_VIDEO,
      { videoId },
      { jobId: videoId },
    );
  }

  /**
   * Publishes again a video whose job may still be around. A job that is
   * waiting, delayed or running is left alone (it will do the work). A job
   * that already ended (`failed` or `completed`) is removed first: it keeps its
   * id, so a plain `publish` would be discarded as a duplicate.
   */
  async republish(videoId: string): Promise<void> {
    const existing = await this.queue.getJob(videoId);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'failed' && state !== 'completed') {
        return;
      }
      await existing.remove();
    }
    await this.publish(videoId);
  }
}
