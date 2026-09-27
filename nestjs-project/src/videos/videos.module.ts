import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { ChannelsModule } from '../channels/channels.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { ImageNormalizerService } from './thumbnails/image-normalizer.service';
import { VideoThumbnailsService } from './thumbnails/video-thumbnails.service';
import { VideoAccessService } from './video-access.service';
import { VideoOwnershipService } from './video-ownership.service';
import { VideoPublicationService } from './video-publication.service';
import { VideoStreamingService } from './video-streaming.service';
import { VideoUploadsService } from './video-uploads.service';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VideosRepositoryModule } from './videos-repository.module';

@Module({
  imports: [
    VideosRepositoryModule,
    StorageModule,
    ChannelsModule,
    CategoriesModule,
    QueueModule,
  ],
  controllers: [VideosController],
  providers: [
    ImageNormalizerService,
    VideoAccessService,
    VideoOwnershipService,
    VideoPublicationService,
    VideoUploadsService,
    VideosService,
    VideoStreamingService,
    VideoThumbnailsService,
  ],
  exports: [VideosRepositoryModule],
})
export class VideosModule {}
