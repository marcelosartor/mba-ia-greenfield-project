import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { VideoUploadsService } from './video-uploads.service';
import { VideosController } from './videos.controller';
import { VideosRepositoryModule } from './videos-repository.module';

@Module({
  imports: [VideosRepositoryModule, StorageModule, ChannelsModule, QueueModule],
  controllers: [VideosController],
  providers: [VideoUploadsService],
  exports: [VideosRepositoryModule],
})
export class VideosModule {}
