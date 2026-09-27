import type { Video } from '../entities/video.entity';
import { VideoStatus } from '../video-status.enum';
import { VideoVisibility } from '../video-visibility.enum';
import type { VideosRepository } from '../videos.repository';
import { VideoListingsService } from './video-listings.service';

const video = (i: number): Video =>
  ({
    id: `id-${i}`,
    public_id: `public${i}`.padEnd(11, 'x'),
    title: `Video ${i}`,
    status: VideoStatus.READY,
    visibility: VideoVisibility.PUBLIC,
    published_at: new Date('2026-09-27T12:00:00Z'),
    created_at: new Date('2026-09-20T12:00:00Z'),
    duration_seconds: 12.5,
    category: { slug: 'musica', name: 'Música' },
    video_key: 'hidden',
  }) as unknown as Video;

describe('VideoListingsService', () => {
  let repository: {
    findPanelPage: jest.Mock;
    findListablePage: jest.Mock;
    countListable: jest.Mock;
  };
  let service: VideoListingsService;

  beforeEach(() => {
    repository = {
      findPanelPage: jest.fn(),
      findListablePage: jest.fn(),
      countListable: jest.fn(),
    };
    service = new VideoListingsService(
      repository as unknown as VideosRepository,
    );
  });

  it('rounds total_pages up and maps the panel items with zero counters', async () => {
    repository.findPanelPage.mockResolvedValue([[video(1)], 45]);

    const result = await service.listPanel('channel-1', 3, 20);

    expect(repository.findPanelPage).toHaveBeenCalledWith('channel-1', 3, 20);
    expect(result).toMatchObject({
      page: 3,
      limit: 20,
      total: 45,
      total_pages: 3,
    });
    expect(result.items[0]).toEqual({
      public_id: video(1).public_id,
      title: 'Video 1',
      thumbnail_url: `/videos/${video(1).public_id}/thumbnail`,
      category: { slug: 'musica', name: 'Música' },
      status: 'ready',
      visibility: 'public',
      published_at: video(1).published_at,
      created_at: video(1).created_at,
      views: 0,
      likes: 0,
      comments: 0,
    });
  });

  it('answers an empty page beyond the last one', async () => {
    repository.findListablePage.mockResolvedValue([[], 3]);

    const result = await service.listPublic('channel-1', 5, 20);

    expect(result).toEqual({
      items: [],
      page: 5,
      limit: 20,
      total: 3,
      total_pages: 1,
    });
  });

  it('maps the public items without internal fields', async () => {
    repository.findListablePage.mockResolvedValue([[video(2)], 1]);

    const [item] = (await service.listPublic('channel-1', 1, 20)).items;

    expect(Object.keys(item).sort()).toEqual([
      'duration_seconds',
      'public_id',
      'published_at',
      'thumbnail_url',
      'title',
    ]);
  });
});
