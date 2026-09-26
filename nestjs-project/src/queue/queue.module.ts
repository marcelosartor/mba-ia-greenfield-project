import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import redisConfig from '../config/redis.config';
import {
  MAINTENANCE_JOB_OPTIONS,
  QUEUE_NAMES,
  VIDEO_PROCESSING_JOB_OPTIONS,
} from './queue.constants';
import { VideoProcessingPublisher } from './video-processing.publisher';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [redisConfig.KEY],
      useFactory: (redis: ConfigType<typeof redisConfig>) => ({
        connection: { host: redis.host, port: redis.port },
        prefix: redis.queuePrefix,
      }),
    }),
    BullModule.registerQueue(
      {
        name: QUEUE_NAMES.VIDEO_PROCESSING,
        defaultJobOptions: { ...VIDEO_PROCESSING_JOB_OPTIONS },
      },
      { name: QUEUE_NAMES.VIDEO_PROCESSING_DLQ },
      {
        name: QUEUE_NAMES.VIDEO_MAINTENANCE,
        defaultJobOptions: { ...MAINTENANCE_JOB_OPTIONS },
      },
    ),
  ],
  providers: [VideoProcessingPublisher],
  exports: [BullModule, VideoProcessingPublisher],
})
export class QueueModule {}
