import { BadRequestException } from '@nestjs/common';
import type { CategoriesService } from '../categories/categories.service';
import { InvalidCategoryException } from '../common/exceptions/domain.exception';
import type { Video } from './entities/video.entity';
import type { VideoAccessService } from './video-access.service';
import type { VideoOwnershipService } from './video-ownership.service';
import { VideoStatus } from './video-status.enum';
import { VideoVisibility } from './video-visibility.enum';
import { VideosService } from './videos.service';
import type { VideosRepository } from './videos.repository';

const owned = {
  id: 'video-1',
  public_id: 'abcdefghijk',
  title: 'Old',
  status: VideoStatus.PROCESSING,
  visibility: VideoVisibility.PUBLIC,
  category: null,
} as unknown as Video;

describe('VideosService.update', () => {
  let ownership: { loadOwned: jest.Mock };
  let repository: {
    updateEditableFields: jest.Mock;
    findByPublicIdWithRelations: jest.Mock;
  };
  let categories: { findBySlug: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    ownership = { loadOwned: jest.fn().mockResolvedValue(owned) };
    repository = {
      updateEditableFields: jest.fn().mockResolvedValue(undefined),
      findByPublicIdWithRelations: jest.fn().mockResolvedValue(owned),
    };
    categories = { findBySlug: jest.fn() };
    service = new VideosService(
      {} as VideoAccessService,
      ownership as unknown as VideoOwnershipService,
      repository as unknown as VideosRepository,
      categories as unknown as CategoriesService,
    );
  });

  it('rejects an empty body before touching the video', async () => {
    await expect(
      service.update('user-a', 'abcdefghijk', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ownership.loadOwned).not.toHaveBeenCalled();
  });

  it('rejects an unknown category slug without writing', async () => {
    categories.findBySlug.mockResolvedValue(null);

    await expect(
      service.update('user-a', 'abcdefghijk', { category: 'inexistente' }),
    ).rejects.toBeInstanceOf(InvalidCategoryException);
    expect(repository.updateEditableFields).not.toHaveBeenCalled();
  });

  it('resolves the category slug to its id', async () => {
    categories.findBySlug.mockResolvedValue({ id: 'cat-1', slug: 'musica' });

    await service.update('user-a', 'abcdefghijk', { category: 'musica' });

    expect(repository.updateEditableFields).toHaveBeenCalledWith(
      'video-1',
      expect.objectContaining({ category_id: 'cat-1' }),
    );
  });

  it('clears the category with null, without looking it up', async () => {
    await service.update('user-a', 'abcdefghijk', { category: null });

    expect(categories.findBySlug).not.toHaveBeenCalled();
    expect(repository.updateEditableFields).toHaveBeenCalledWith(
      'video-1',
      expect.objectContaining({ category_id: null }),
    );
  });

  it('sends only the fields that came in the body', async () => {
    await service.update('user-a', 'abcdefghijk', { description: null });

    const [, changes] = repository.updateEditableFields.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(changes).toEqual({
      title: undefined,
      description: null,
      visibility: undefined,
    });
  });
});
