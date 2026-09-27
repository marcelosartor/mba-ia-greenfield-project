import { Readable } from 'node:stream';
import {
  InvalidImageException,
  VideoAccessDeniedException,
  VideoNotFoundException,
} from '../../common/exceptions/domain.exception';
import type { StorageService } from '../../storage/storage.service';
import type { Video } from '../entities/video.entity';
import { VideoAccessService } from '../video-access.service';
import { VideoStatus } from '../video-status.enum';
import type { VideoOwnershipService } from '../video-ownership.service';
import type { VideosRepository } from '../videos.repository';
import type { ImageNormalizerService } from './image-normalizer.service';
import { VideoThumbnailsService } from './video-thumbnails.service';

const published = {
  id: 'video-1',
  public_id: 'abcdefghijk',
  status: VideoStatus.READY,
  published_at: new Date('2026-09-27T12:00:00Z'),
  channel: { user_id: 'owner-user' },
  thumbnail_key: 'video-1/default.jpg',
  custom_thumbnail_key: null,
} as unknown as Video;

describe('VideoThumbnailsService', () => {
  let repository: {
    findByPublicIdWithRelations: jest.Mock;
    setCustomThumbnailKey: jest.Mock;
  };
  let storage: {
    thumbnailsBucket: string;
    getObjectRange: jest.Mock;
    putObject: jest.Mock;
    deleteObject: jest.Mock;
  };
  let ownership: { loadOwned: jest.Mock };
  let normalizer: { normalize: jest.Mock };
  let service: VideoThumbnailsService;

  beforeEach(() => {
    repository = {
      findByPublicIdWithRelations: jest.fn().mockResolvedValue(published),
      setCustomThumbnailKey: jest.fn().mockResolvedValue(undefined),
    };
    ownership = { loadOwned: jest.fn().mockResolvedValue(published) };
    normalizer = {
      normalize: jest.fn().mockResolvedValue(Buffer.from('normalized')),
    };
    storage = {
      thumbnailsBucket: 'thumbnails',
      getObjectRange: jest.fn().mockResolvedValue({
        body: Readable.from([Buffer.from('jpeg')]),
        contentLength: 4,
        etag: '"etag"',
      }),
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    // The real access rules over a mocked repository.
    service = new VideoThumbnailsService(
      new VideoAccessService(repository as unknown as VideosRepository),
      storage as unknown as StorageService,
      ownership as unknown as VideoOwnershipService,
      normalizer as unknown as ImageNormalizerService,
      repository as unknown as VideosRepository,
    );
  });

  describe('getThumbnail', () => {
    it('serves the generated cover when there is no custom one', async () => {
      const result = await service.getThumbnail('abcdefghijk', undefined);

      expect(storage.getObjectRange).toHaveBeenCalledWith(
        'thumbnails',
        'video-1/default.jpg',
      );
      expect(result.headers).toEqual({
        'Content-Type': 'image/jpeg',
        'Content-Length': '4',
        'Cache-Control': 'private, no-cache',
        ETag: '"etag"',
      });
    });

    it('prefers the custom cover', async () => {
      repository.findByPublicIdWithRelations.mockResolvedValue({
        ...published,
        custom_thumbnail_key: 'video-1/custom.jpg',
      });

      await service.getThumbnail('abcdefghijk', undefined);

      expect(storage.getObjectRange).toHaveBeenCalledWith(
        'thumbnails',
        'video-1/custom.jpg',
      );
    });

    it('answers not found when the video has no cover at all', async () => {
      repository.findByPublicIdWithRelations.mockResolvedValue({
        ...published,
        thumbnail_key: null,
      });

      await expect(
        service.getThumbnail('abcdefghijk', undefined),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('hides the cover of a draft from an anonymous caller', async () => {
      repository.findByPublicIdWithRelations.mockResolvedValue({
        ...published,
        published_at: null,
      });

      await expect(
        service.getThumbnail('abcdefghijk', undefined),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(storage.getObjectRange).not.toHaveBeenCalled();
    });
  });

  describe('setCustom', () => {
    it('checks the owner before decoding anything', async () => {
      ownership.loadOwned.mockRejectedValue(new VideoAccessDeniedException());

      await expect(
        service.setCustom('user-b', 'abcdefghijk', Buffer.from('png')),
      ).rejects.toBeInstanceOf(VideoAccessDeniedException);
      expect(normalizer.normalize).not.toHaveBeenCalled();
    });

    it('stores nothing when the image is invalid', async () => {
      normalizer.normalize.mockRejectedValue(new InvalidImageException());

      await expect(
        service.setCustom('owner-user', 'abcdefghijk', Buffer.from('text')),
      ).rejects.toBeInstanceOf(InvalidImageException);
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(repository.setCustomThumbnailKey).not.toHaveBeenCalled();
    });

    it('stores the normalized JPEG at {videoId}/custom.jpg, then records the key', async () => {
      const order: string[] = [];
      storage.putObject.mockImplementation(() => {
        order.push('put');
        return Promise.resolve();
      });
      repository.setCustomThumbnailKey.mockImplementation(() => {
        order.push('key');
        return Promise.resolve();
      });

      await service.setCustom('owner-user', 'abcdefghijk', Buffer.from('png'));

      expect(storage.putObject).toHaveBeenCalledWith(
        'thumbnails',
        'video-1/custom.jpg',
        Buffer.from('normalized'),
        'image/jpeg',
      );
      expect(repository.setCustomThumbnailKey).toHaveBeenCalledWith(
        'video-1',
        'video-1/custom.jpg',
      );
      expect(order).toEqual(['put', 'key']);
    });
  });

  describe('removeCustom', () => {
    it('checks the owner first', async () => {
      ownership.loadOwned.mockRejectedValue(new VideoAccessDeniedException());

      await expect(
        service.removeCustom('user-b', 'abcdefghijk'),
      ).rejects.toBeInstanceOf(VideoAccessDeniedException);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });

    it('does nothing when there is no custom cover', async () => {
      await service.removeCustom('owner-user', 'abcdefghijk');

      expect(repository.setCustomThumbnailKey).not.toHaveBeenCalled();
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });

    it('clears the key, then removes the object', async () => {
      ownership.loadOwned.mockResolvedValue({
        ...published,
        custom_thumbnail_key: 'video-1/custom.jpg',
      });
      const order: string[] = [];
      repository.setCustomThumbnailKey.mockImplementation(() => {
        order.push('key');
        return Promise.resolve();
      });
      storage.deleteObject.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve();
      });

      await service.removeCustom('owner-user', 'abcdefghijk');

      expect(repository.setCustomThumbnailKey).toHaveBeenCalledWith(
        'video-1',
        null,
      );
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'thumbnails',
        'video-1/custom.jpg',
      );
      expect(order).toEqual(['key', 'delete']);
    });
  });
});
