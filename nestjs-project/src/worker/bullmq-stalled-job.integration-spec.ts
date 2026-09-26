import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import redisConfig from '../config/redis.config';

jest.setTimeout(45000);

/**
 * The failure handling of `VideoProcessor` relies on how BullMQ ends a job that
 * stalled more often than allowed: with an `UnrecoverableError` while attempts
 * are still left. This pins that behaviour against the real Redis, so an
 * upgrade of BullMQ that changes it fails here instead of leaving videos in
 * `processing` again.
 */
describe('BullMQ stalled job (integration)', () => {
  const redis = redisConfig();
  const connection = { host: redis.host, port: redis.port };
  const name = `stalled-assumption-${randomUUID()}`;
  let queue: Queue;
  let worker: Worker;
  let lockKiller: NodeJS.Timeout | undefined;
  let redisClient: IORedis | undefined;

  afterEach(async () => {
    if (lockKiller) clearInterval(lockKiller);
    await worker?.close(true);
    await queue?.obliterate({ force: true });
    await queue?.close();
    redisClient?.disconnect();
  });

  it('should fail a job stalled twice with an UnrecoverableError and attempts left', async () => {
    queue = new Queue(name, { connection, prefix: redis.queuePrefix });
    let runs = 0;
    worker = new Worker(
      name,
      () => {
        runs++;
        return new Promise<void>(() => undefined); // never finishes
      },
      {
        connection,
        prefix: redis.queuePrefix,
        lockDuration: 500,
        stalledInterval: 500,
        maxStalledCount: 1,
        // Each hung run keeps a slot. In production another worker picks the
        // recovered job and later collects the final failure; here the same
        // worker needs free slots for both.
        concurrency: 5,
      },
    );
    // the lock removed below makes the renewal fail; that is the point
    worker.on('error', () => undefined);
    const failed = new Promise<{ attemptsMade: number; error: Error }>(
      (resolve) => {
        worker.on('failed', (job, error) => {
          resolve({ attemptsMade: job?.attemptsMade ?? -1, error });
        });
      },
    );
    const job = await queue.add(
      'process-video',
      { videoId: 'x' },
      { attempts: 3 },
    );
    // A worker that dies stops renewing the lock; removing it stands for that.
    redisClient = new IORedis(redis.port, redis.host);
    const client = redisClient;
    lockKiller = setInterval(() => {
      void client.del(`${redis.queuePrefix}:${name}:${job.id}:lock`);
    }, 100);

    const result = await failed;

    expect(result.error).toBeInstanceOf(UnrecoverableError);
    expect(result.error.message).toContain('stalled');
    expect(result.attemptsMade).toBeLessThan(3);
    expect(runs).toBeGreaterThanOrEqual(2); // it was recovered once first
  });
});
