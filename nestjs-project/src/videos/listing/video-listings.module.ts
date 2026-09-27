import { Module } from '@nestjs/common';
import { VideosRepositoryModule } from '../videos-repository.module';
import { VideoListingsService } from './video-listings.service';

/**
 * Only the repository module is imported, so ChannelsModule can use the
 * listings without a cycle with VideosModule (which imports ChannelsModule).
 */
@Module({
  imports: [VideosRepositoryModule],
  providers: [VideoListingsService],
  exports: [VideoListingsService],
})
export class VideoListingsModule {}
