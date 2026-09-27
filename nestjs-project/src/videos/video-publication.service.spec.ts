import {
  VideoAccessDeniedException,
  VideoNotPublishableException,
} from '../common/exceptions/domain.exception';
import type { Video } from './entities/video.entity';
import type { VideoOwnershipService } from './video-ownership.service';
import { VideoPublicationService } from './video-publication.service';
import { VideoVisibility } from './video-visibility.enum';
import type { VideosRepository } from './videos.repository';

const owned = { id: 'video-1', public_id: 'abcdefghijk' } as Video;

describe('VideoPublicationService', () => {
  let ownership: { loadOwned: jest.Mock };
  let repository: {
    publish: jest.Mock;
    unpublish: jest.Mock;
    findByPublicIdWithRelations: jest.Mock;
  };
  let service: VideoPublicationService;

  beforeEach(() => {
    ownership = { loadOwned: jest.fn().mockResolvedValue(owned) };
    repository = {
      publish: jest.fn().mockResolvedValue(true),
      unpublish: jest.fn().mockResolvedValue(undefined),
      findByPublicIdWithRelations: jest
        .fn()
        .mockResolvedValue({ ...owned, category: null }),
    };
    service = new VideoPublicationService(
      ownership as unknown as VideoOwnershipService,
      repository as unknown as VideosRepository,
    );
  });

  describe('publish', () => {
    it('publishes as public by default', async () => {
      await service.publish('user-a', 'abcdefghijk');

      expect(repository.publish).toHaveBeenCalledWith(
        'video-1',
        VideoVisibility.PUBLIC,
      );
    });

    it('answers not publishable when the conditional update touches no row', async () => {
      repository.publish.mockResolvedValue(false);

      await expect(
        service.publish('user-a', 'abcdefghijk', VideoVisibility.UNLISTED),
      ).rejects.toBeInstanceOf(VideoNotPublishableException);
    });

    it('checks the owner before writing', async () => {
      ownership.loadOwned.mockRejectedValue(new VideoAccessDeniedException());

      await expect(
        service.publish('user-b', 'abcdefghijk'),
      ).rejects.toBeInstanceOf(VideoAccessDeniedException);
      expect(repository.publish).not.toHaveBeenCalled();
    });
  });

  describe('unpublish', () => {
    it('checks the owner before writing', async () => {
      ownership.loadOwned.mockRejectedValue(new VideoAccessDeniedException());

      await expect(
        service.unpublish('user-b', 'abcdefghijk'),
      ).rejects.toBeInstanceOf(VideoAccessDeniedException);
      expect(repository.unpublish).not.toHaveBeenCalled();
    });

    it('clears the publication of a draft without failing', async () => {
      await expect(
        service.unpublish('user-a', 'abcdefghijk'),
      ).resolves.toBeUndefined();
      expect(repository.unpublish).toHaveBeenCalledWith('video-1');
    });
  });
});
