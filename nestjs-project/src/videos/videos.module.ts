import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { VideoUploadsService } from './video-uploads.service';
import { VideosController } from './videos.controller';
import { VideosRepository } from './videos.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    StorageModule,
    ChannelsModule,
    QueueModule,
  ],
  controllers: [VideosController],
  providers: [VideosRepository, VideoUploadsService],
  exports: [TypeOrmModule, VideosRepository],
})
export class VideosModule {}
