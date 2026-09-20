import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { UploadsSweeperService } from './uploads-sweeper.service';

@Processor(QUEUE_NAMES.VIDEO_MAINTENANCE)
export class UploadsSweeperProcessor extends WorkerHost {
  private readonly logger = new Logger(UploadsSweeperProcessor.name);

  constructor(private readonly sweeper: UploadsSweeperService) {
    super();
  }

  async process(): Promise<void> {
    const result = await this.sweeper.run();
    if (result.abandonedRemoved > 0 || result.jobsRepublished > 0) {
      this.logger.log(
        `Sweep done: ${result.abandonedRemoved} abandoned upload(s) removed, ${result.jobsRepublished} job(s) republished`,
      );
    }
  }
}
