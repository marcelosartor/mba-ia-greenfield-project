import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  SWEEPER_SCHEDULER_ID,
} from '../queue/queue.constants';
import { SWEEP_INTERVAL_MS } from './uploads-sweeper.constants';

/** Registers the recurring sweep when the worker starts. */
@Injectable()
export class UploadsSweeperScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.VIDEO_MAINTENANCE)
    private readonly maintenanceQueue: Queue,
  ) {}

  // upsert: starting several workers, or restarting one, keeps a single schedule
  async onApplicationBootstrap(): Promise<void> {
    await this.maintenanceQueue.upsertJobScheduler(
      SWEEPER_SCHEDULER_ID,
      { every: SWEEP_INTERVAL_MS },
      { name: JOB_NAMES.SWEEP_ABANDONED_UPLOADS, data: {} },
    );
  }
}
