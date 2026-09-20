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
}
