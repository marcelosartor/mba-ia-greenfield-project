import { Module } from '@nestjs/common';
import { appConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { VideosRepositoryModule } from '../videos/videos-repository.module';
import { MediaModule } from './media/media.module';
import { UploadsSweeperProcessor } from './uploads-sweeper.processor';
import { UploadsSweeperScheduler } from './uploads-sweeper.scheduler';
import { UploadsSweeperService } from './uploads-sweeper.service';
import { VideoProcessor } from './video.processor';

/** Root module of the video worker: no HTTP, only the queue consumer. */
@Module({
  imports: [
    appConfigModule,
    DatabaseModule,
    QueueModule,
    StorageModule,
    MediaModule,
    VideosRepositoryModule,
    // Registers User and Channel: TypeORM needs the whole entity graph that
    // Video relates to (Video -> Channel -> User), even if the worker never
    // queries them.
    UsersModule,
  ],
  providers: [
    VideoProcessor,
    UploadsSweeperService,
    UploadsSweeperProcessor,
    UploadsSweeperScheduler,
  ],
})
export class WorkerModule {}
