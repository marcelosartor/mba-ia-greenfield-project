import { Injectable } from '@nestjs/common';
import { type Paginated, paginate } from '../../common/pagination/paginated';
import type { Video } from '../entities/video.entity';
import { thumbnailUrlOf } from '../video-response.mapper';
import { VideosRepository } from '../videos.repository';
import type { PanelVideoItemDto } from './dto/panel-video-item.dto';
import type { PublicVideoItemDto } from './dto/public-video-item.dto';

/**
 * Listings of a channel's videos (Phase 04, TD-09/TD-10). They live in the
 * videos module because they query Video; the channels controller only
 * declares the routes and resolves the channel.
 */
@Injectable()
export class VideoListingsService {
  constructor(private readonly videosRepository: VideosRepository) {}

  async listPanel(
    channelId: string,
    page: number,
    limit: number,
  ): Promise<Paginated<PanelVideoItemDto>> {
    const [videos, total] = await this.videosRepository.findPanelPage(
      channelId,
      page,
      limit,
    );
    return paginate(videos.map(toPanelItem), total, page, limit);
  }

  async listPublic(
    channelId: string,
    page: number,
    limit: number,
  ): Promise<Paginated<PublicVideoItemDto>> {
    const [videos, total] = await this.videosRepository.findListablePage(
      channelId,
      page,
      limit,
    );
    return paginate(videos.map(toPublicItem), total, page, limit);
  }

  async countListable(channelId: string): Promise<number> {
    return this.videosRepository.countListable(channelId);
  }
}

function toPanelItem(video: Video): PanelVideoItemDto {
  return {
    public_id: video.public_id,
    title: video.title,
    thumbnail_url: thumbnailUrlOf(video.public_id),
    category: video.category
      ? { slug: video.category.slug, name: video.category.name }
      : null,
    status: video.status,
    visibility: video.visibility,
    published_at: video.published_at,
    created_at: video.created_at,
    // Placeholders until Phases 05 and 06: the contract does not change then.
    views: 0,
    likes: 0,
    comments: 0,
  };
}

function toPublicItem(video: Video): PublicVideoItemDto {
  return {
    public_id: video.public_id,
    title: video.title,
    thumbnail_url: thumbnailUrlOf(video.public_id),
    duration_seconds: video.duration_seconds,
    // Listable implies published.
    published_at: video.published_at!,
  };
}
