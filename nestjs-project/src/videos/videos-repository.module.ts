import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../categories/entities/category.entity';
import { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';

/** Persistence of videos, shared by the API and the video worker. */
@Module({
  // Category is registered too: Video relates to it (category join).
  imports: [TypeOrmModule.forFeature([Video, Category])],
  providers: [VideosRepository],
  exports: [TypeOrmModule, VideosRepository],
})
export class VideosRepositoryModule {}
