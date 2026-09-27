import {
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import type { Video } from './entities/video.entity';
import { VideoAccessService } from './video-access.service';
import { VideoStatus } from './video-status.enum';
import type { VideosRepository } from './videos.repository';

const OWNER = 'owner-user';

const makeVideo = (overrides: Partial<Video> = {}): Video =>
  ({
    id: 'internal-uuid',
    public_id: 'abcdefghijk',
    status: VideoStatus.READY,
    published_at: new Date('2026-09-27T12:00:00Z'),
    channel: { user_id: OWNER },
    ...overrides,
  }) as Video;

describe('VideoAccessService', () => {
  let repository: { findByPublicIdWithRelations: jest.Mock };
  let service: VideoAccessService;

  beforeEach(() => {
    repository = { findByPublicIdWithRelations: jest.fn() };
    service = new VideoAccessService(repository as unknown as VideosRepository);
  });

  it('should answer not found for an unknown public_id', async () => {
    repository.findByPublicIdWithRelations.mockResolvedValue(null);

    await expect(
      service.loadReadable('aaaaaaaaaaa', OWNER),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it.each([
    ['an anonymous caller', undefined],
    ['another user', 'someone-else'],
  ])('should hide a ready draft from %s', async (_label, viewer) => {
    repository.findByPublicIdWithRelations.mockResolvedValue(
      makeVideo({ published_at: null }),
    );

    await expect(
      service.loadReadable('abcdefghijk', viewer),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it('should serve a ready draft to its owner', async () => {
    const draft = makeVideo({ published_at: null });
    repository.findByPublicIdWithRelations.mockResolvedValue(draft);

    await expect(service.loadReadable('abcdefghijk', OWNER)).resolves.toBe(
      draft,
    );
  });

  it('should answer 404 before 409: a processing draft is not found for anonymous', async () => {
    repository.findByPublicIdWithRelations.mockResolvedValue(
      makeVideo({ status: VideoStatus.PROCESSING, published_at: null }),
    );

    await expect(
      service.loadReadable('abcdefghijk', undefined),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.ERROR])(
    'should answer not ready to the owner of a %s video',
    async (status) => {
      repository.findByPublicIdWithRelations.mockResolvedValue(
        makeVideo({ status, published_at: null }),
      );

      await expect(
        service.loadReadable('abcdefghijk', OWNER),
      ).rejects.toBeInstanceOf(VideoNotReadyException);
    },
  );

  it('should serve a published video to an anonymous caller', async () => {
    const published = makeVideo();
    repository.findByPublicIdWithRelations.mockResolvedValue(published);

    await expect(service.loadReadable('abcdefghijk', undefined)).resolves.toBe(
      published,
    );
  });
});
