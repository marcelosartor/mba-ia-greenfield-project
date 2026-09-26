import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, SWEEPER_SCHEDULER_ID } from '../queue/queue.constants';
import { waitFor } from '../test/wait-for';
import { WorkerModule } from './worker.module';

jest.setTimeout(60000);

describe('UploadsSweeperScheduler (integration)', () => {
  let module: TestingModule;
  let maintenanceQueue: Queue;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    maintenanceQueue = module.get<Queue>(
      getQueueToken(QUEUE_NAMES.VIDEO_MAINTENANCE),
    );
    await maintenanceQueue.obliterate({ force: true });
    await module.init();
  });

  afterAll(async () => {
    await maintenanceQueue.obliterate({ force: true });
    await module.close();
  });

  it('should register the abandoned-uploads-sweep scheduler every 15 minutes', async () => {
    const scheduler =
      await maintenanceQueue.getJobScheduler(SWEEPER_SCHEDULER_ID);

    expect(scheduler).toMatchObject({
      key: 'abandoned-uploads-sweep',
      name: 'sweep-abandoned-uploads',
      every: 900000,
    });
  });

  it('should keep a single scheduler when the worker starts again', async () => {
    const second = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await second.init();

    await waitFor(
      async () => (await maintenanceQueue.getJobSchedulersCount()) > 0,
    );
    expect(await maintenanceQueue.getJobSchedulersCount()).toBe(1);
    await second.close();
  });
});
