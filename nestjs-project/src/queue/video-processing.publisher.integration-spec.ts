import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { JobType, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import redisConfig from '../config/redis.config';
import { QUEUE_NAMES } from './queue.constants';
import { QueueModule } from './queue.module';
import { VideoProcessingPublisher } from './video-processing.publisher';

jest.setTimeout(30000);

const ALL_STATES: JobType[] = [
  'waiting',
  'delayed',
  'active',
  'completed',
  'failed',
];

describe('VideoProcessingPublisher (integration)', () => {
  let module: TestingModule;
  let publisher: VideoProcessingPublisher;
  let processingQueue: Queue;
  let dlq: Queue;
  let maintenanceQueue: Queue;

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

    publisher = module.get(VideoProcessingPublisher);
    processingQueue = module.get<Queue>(
      getQueueToken(QUEUE_NAMES.VIDEO_PROCESSING),
    );
    dlq = module.get<Queue>(getQueueToken(QUEUE_NAMES.VIDEO_PROCESSING_DLQ));
    maintenanceQueue = module.get<Queue>(
      getQueueToken(QUEUE_NAMES.VIDEO_MAINTENANCE),
    );
  });

  beforeEach(async () => {
    for (const queue of [processingQueue, dlq, maintenanceQueue]) {
      await queue.obliterate({ force: true });
    }
  });

  afterAll(async () => {
    for (const queue of [processingQueue, dlq, maintenanceQueue]) {
      await queue.obliterate({ force: true });
    }
    await module.close();
  });

  it('should leave exactly one job when the same video is published twice', async () => {
    const videoId = randomUUID();

    await publisher.publish(videoId);
    await publisher.publish(videoId);

    const jobs = await processingQueue.getJobs(ALL_STATES);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(videoId);
    expect(jobs[0].name).toBe('process-video');
    expect(jobs[0].data).toEqual({ videoId });
  });

  it('should keep one job per distinct video', async () => {
    await publisher.publish(randomUUID());
    await publisher.publish(randomUUID());

    const jobs = await processingQueue.getJobs(ALL_STATES);
    expect(jobs).toHaveLength(2);
  });

  it('should publish jobs with 3 attempts and exponential backoff of 5000 ms', async () => {
    await publisher.publish(randomUUID());

    const [job] = await processingQueue.getJobs(ALL_STATES);
    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('should have the dead-letter and maintenance queues accept jobs', async () => {
    await dlq.add('dead-lettered-video', {
      videoId: randomUUID(),
      failedReason: 'boom',
      attemptsMade: 3,
    });
    await maintenanceQueue.add('sweep-abandoned-uploads', {});

    expect(await dlq.getJobs(ALL_STATES)).toHaveLength(1);
    expect(await maintenanceQueue.getJobs(ALL_STATES)).toHaveLength(1);
  });

  it('should connect to the host from the Redis config (the Compose service name)', () => {
    const redis = module.get<ConfigType<typeof redisConfig>>(redisConfig.KEY);
    const connection = processingQueue.opts.connection as {
      host?: string;
      port?: number;
    };

    expect(redis.host).toBe('redis');
    expect(connection.host).toBe(redis.host);
    expect(connection.port).toBe(redis.port);
  });
});
