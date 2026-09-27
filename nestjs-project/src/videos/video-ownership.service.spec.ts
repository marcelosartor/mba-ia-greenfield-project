import type { ChannelsService } from '../channels/channels.service';
import {
  VideoAccessDeniedException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import type { Video } from './entities/video.entity';
import { VideoOwnershipService } from './video-ownership.service';
import type { VideosRepository } from './videos.repository';

describe('VideoOwnershipService', () => {
  const video = { id: 'video-1', channel_id: 'channel-a' } as Video;
  let repository: { findByPublicId: jest.Mock };
  let channels: { findByUserId: jest.Mock };
  let service: VideoOwnershipService;

  beforeEach(() => {
    repository = { findByPublicId: jest.fn().mockResolvedValue(video) };
    channels = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'channel-a' }),
    };
    service = new VideoOwnershipService(
      repository as unknown as VideosRepository,
      channels as unknown as ChannelsService,
    );
  });

  it('returns the video to the owner of its channel', async () => {
    await expect(service.loadOwned('user-a', 'abcdefghijk')).resolves.toBe(
      video,
    );
  });

  it('answers not found for an unknown public_id, before looking at the caller', async () => {
    repository.findByPublicId.mockResolvedValue(null);

    await expect(
      service.loadOwned('user-a', 'aaaaaaaaaaa'),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    expect(channels.findByUserId).not.toHaveBeenCalled();
  });

  it('denies a user whose channel is another one', async () => {
    channels.findByUserId.mockResolvedValue({ id: 'channel-b' });

    await expect(
      service.loadOwned('user-b', 'abcdefghijk'),
    ).rejects.toBeInstanceOf(VideoAccessDeniedException);
  });

  it('denies a user without a channel', async () => {
    channels.findByUserId.mockResolvedValue(null);

    await expect(
      service.loadOwned('user-c', 'abcdefghijk'),
    ).rejects.toBeInstanceOf(VideoAccessDeniedException);
  });
});
