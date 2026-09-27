import type { Video } from './entities/video.entity';
import { toVideoResponse } from './video-response.mapper';
import { VideoStatus } from './video-status.enum';
import { VideoVisibility } from './video-visibility.enum';

const createdAt = new Date('2026-09-20T12:00:00Z');
const updatedAt = new Date('2026-09-27T12:00:00Z');

const makeVideo = (overrides: Partial<Video> = {}): Video =>
  ({
    id: 'internal-uuid',
    public_id: 'abcdefghijk',
    channel_id: 'channel-1',
    title: 'Holiday',
    description: 'About it',
    category_id: 'category-uuid',
    category: { id: 'category-uuid', slug: 'musica', name: 'Música' },
    status: VideoStatus.READY,
    visibility: VideoVisibility.PUBLIC,
    published_at: updatedAt,
    video_key: 'channel-1/internal-uuid/source.mp4',
    thumbnail_key: 'internal-uuid/default.jpg',
    custom_thumbnail_key: 'internal-uuid/custom.jpg',
    upload_id: null,
    duration_seconds: 12.5,
    width: 640,
    height: 360,
    created_at: createdAt,
    updated_at: updatedAt,
    ...overrides,
  }) as Video;

describe('toVideoResponse', () => {
  it('should expose the Phase 04 read contract', () => {
    expect(toVideoResponse(makeVideo())).toEqual({
      public_id: 'abcdefghijk',
      title: 'Holiday',
      description: 'About it',
      category: { slug: 'musica', name: 'Música' },
      status: 'ready',
      visibility: 'public',
      published_at: updatedAt,
      thumbnail_url: '/videos/abcdefghijk/thumbnail',
      duration_seconds: 12.5,
      width: 640,
      height: 360,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  });

  it('should return a null category when the video has none', () => {
    expect(
      toVideoResponse(makeVideo({ category_id: null, category: null }))
        .category,
    ).toBeNull();
  });

  it('should never expose the internal id, the channel id or the storage keys', () => {
    const keys = Object.keys(toVideoResponse(makeVideo()));

    for (const hidden of [
      'id',
      'channel_id',
      'category_id',
      'video_key',
      'thumbnail_key',
      'custom_thumbnail_key',
      'upload_id',
    ]) {
      expect(keys).not.toContain(hidden);
    }
  });
});
