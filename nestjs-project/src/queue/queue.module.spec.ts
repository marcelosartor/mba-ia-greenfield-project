import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import redisConfig from '../config/redis.config';
import { QUEUE_NAMES } from './queue.constants';
import { QueueModule } from './queue.module';
import { VideoProcessingPublisher } from './video-processing.publisher';

describe('QueueModule', () => {
  it('should compile and expose the publisher and the three queues', async () => {
    const fakeQueue = { add: jest.fn() };
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [redisConfig],
        }),
        QueueModule,
      ],
    });
    for (const name of Object.values(QUEUE_NAMES)) {
      builder.overrideProvider(getQueueToken(name)).useValue(fakeQueue);
    }

    const module = await builder.compile();

    expect(module.get(VideoProcessingPublisher)).toBeInstanceOf(
      VideoProcessingPublisher,
    );
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(module.get(getQueueToken(name))).toBe(fakeQueue);
    }
    await module.close();
  });
});
