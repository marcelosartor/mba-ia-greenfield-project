import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from './entities/channel.entity';
import { VideoListingsModule } from '../videos/listing/video-listings.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({
  // VideoListingsModule does not import ChannelsModule back: no cycle.
  imports: [TypeOrmModule.forFeature([Channel]), VideoListingsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [TypeOrmModule, ChannelsService],
})
export class ChannelsModule {}
