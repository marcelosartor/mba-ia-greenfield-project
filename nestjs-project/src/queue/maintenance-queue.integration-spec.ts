import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Worker, type Queue } from 'bullmq';
import redisConfig from '../config/redis.config';
import { waitFor } from '../test/wait-for';
import {
  JOB_NAMES,
  MAINTENANCE_JOB_OPTIONS,
  QUEUE_NAMES,
  SWEEPER_SCHEDULER_ID,
} from './queue.constants';
import { QueueModule } from './queue.module';

jest.setTimeout(60000);

describe('video-maintenance queue retention (integration)', () => {
  let module: TestingModule;
  let queue: Queue;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [redisConfig],
        }),
        QueueModule,
      ],
    }).compile();
    queue = module.get<Queue>(getQueueToken(QUEUE_NAMES.VIDEO_MAINTENANCE));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await module.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  it('should give the queue the retention as its default job options', () => {
    expect(queue.opts.defaultJobOptions).toMatchObject(MAINTENANCE_JOB_OPTIONS);
  });

  it('should make the jobs the scheduler creates inherit the retention', async () => {
    await queue.upsertJobScheduler(
      SWEEPER_SCHEDULER_ID,
      { every: 900_000 },
      { name: JOB_NAMES.SWEEP_ABANDONED_UPLOADS, data: {} },
    );

    const [job] = await queue.getJobs(['delayed', 'waiting', 'prioritized']);

    expect(job.opts.removeOnComplete).toEqual(
      MAINTENANCE_JOB_OPTIONS.removeOnComplete,
    );
    expect(job.opts.removeOnFail).toEqual(MAINTENANCE_JOB_OPTIONS.removeOnFail);
  });

  it('should keep no more finished jobs than the retention allows', async () => {
    const redis = module.get<{
      host: string;
      port: number;
      queuePrefix: string;
    }>(redisConfig.KEY);
    const total = MAINTENANCE_JOB_OPTIONS.removeOnComplete.count + 40;
    const worker = new Worker(
      QUEUE_NAMES.VIDEO_MAINTENANCE,
      () => Promise.resolve(),
      {
        connection: { host: redis.host, port: redis.port },
        prefix: redis.queuePrefix,
        concurrency: 5,
      },
    );
    try {
      for (let i = 0; i < total; i++) {
        await queue.add(JOB_NAMES.SWEEP_ABANDONED_UPLOADS, {});
      }

      await waitFor(async () => {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
        return (
          counts.waiting + counts.active + counts.delayed === 0 || undefined
        );
      });
    } finally {
      await worker.close();
    }

    const completed = await queue.getJobCountByTypes('completed');
    expect(completed).toBeLessThanOrEqual(
      MAINTENANCE_JOB_OPTIONS.removeOnComplete.count,
    );
    expect(completed).toBeGreaterThan(0);
  });
});
