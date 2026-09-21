import {
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import type { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideosService } from './videos.service';
import type { VideosRepository } from './videos.repository';

const createdAt = new Date('2026-09-20T12:00:00Z');

const makeVideo = (overrides: Partial<Video> = {}): Video =>
  ({
    id: 'internal-uuid',
    public_id: 'abcdefghijk',
    channel_id: 'channel-1',
    title: 'Holiday',
    status: VideoStatus.READY,
    video_key: 'channel-1/internal-uuid/source.mp4',
    thumbnail_key: 'internal-uuid/default.jpg',
    upload_id: null,
    duration_seconds: 12.5,
    width: 640,
    height: 360,
    created_at: createdAt,
    ...overrides,
  }) as Video;

describe('VideosService', () => {
  let repository: { findByPublicId: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    repository = { findByPublicId: jest.fn() };
    service = new VideosService(repository as unknown as VideosRepository);
  });

  describe('getReadyVideo', () => {
    it('should return only the public metadata of a ready video', async () => {
      repository.findByPublicId.mockResolvedValue(makeVideo());

      const result = await service.getReadyVideo('abcdefghijk');

      expect(repository.findByPublicId).toHaveBeenCalledWith('abcdefghijk');
      expect(result).toEqual({
        public_id: 'abcdefghijk',
        title: 'Holiday',
        status: 'ready',
        duration_seconds: 12.5,
        width: 640,
        height: 360,
        created_at: createdAt,
      });
    });

    it('should not leak storage keys or internal ids', async () => {
      repository.findByPublicId.mockResolvedValue(makeVideo());

      const result = await service.getReadyVideo('abcdefghijk');

      expect(Object.keys(result).sort()).toEqual([
        'created_at',
        'duration_seconds',
        'height',
        'public_id',
        'status',
        'title',
        'width',
      ]);
    });

    it('should throw VideoNotFoundException when the public_id does not exist', async () => {
      repository.findByPublicId.mockResolvedValue(null);

      await expect(service.getReadyVideo('aaaaaaaaaaa')).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
    });

    it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.ERROR])(
      'should throw VideoNotReadyException for a video in %s',
      async (status) => {
        repository.findByPublicId.mockResolvedValue(makeVideo({ status }));

        await expect(
          service.getReadyVideo('abcdefghijk'),
        ).rejects.toBeInstanceOf(VideoNotReadyException);
      },
    );
  });
});
