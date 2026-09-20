import type { ConfigType } from '@nestjs/config';
import type { ChannelsService } from '../channels/channels.service';
import type { Channel } from '../channels/entities/channel.entity';
import {
  ChannelNotFoundException,
  StorageUnavailableException,
  UnsupportedVideoFormatException,
  UploadAlreadyCompletedException,
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import type videoConfig from '../config/video.config';
import type { StorageService } from '../storage/storage.service';
import type { CreateVideoDto } from './dto/create-video.dto';
import type { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideoUploadsService } from './video-uploads.service';
import type { VideosRepository } from './videos.repository';

const config: ConfigType<typeof videoConfig> = {
  partSizeBytes: 64 * 1024 * 1024,
  workerConcurrency: 1,
  processingTimeoutMs: 1_800_000,
};

const channel = { id: 'channel-1', user_id: 'user-1' } as Channel;
const draft = {
  id: 'video-1',
  public_id: 'abcdefghijk',
  status: VideoStatus.DRAFT,
  video_key: 'channel-1/video-1/source.mp4',
} as Video;

const validDto: CreateVideoDto = {
  filename: 'My Holiday.mp4',
  content_type: 'video/mp4',
  size_bytes: 200_000_000,
};

describe('VideoUploadsService', () => {
  let channelsService: { findByUserId: jest.Mock };
  let videosRepository: {
    createDraft: jest.Mock;
    findByPublicId: jest.Mock;
    setUploadId: jest.Mock;
    deleteById: jest.Mock;
  };
  let storageService: {
    createMultipartUpload: jest.Mock;
    abortMultipartUpload: jest.Mock;
    listParts: jest.Mock;
    presignUploadPart: jest.Mock;
  };
  let service: VideoUploadsService;

  beforeEach(() => {
    channelsService = { findByUserId: jest.fn().mockResolvedValue(channel) };
    videosRepository = {
      createDraft: jest.fn().mockResolvedValue(draft),
      findByPublicId: jest.fn(),
      setUploadId: jest.fn().mockResolvedValue(undefined),
      deleteById: jest.fn().mockResolvedValue(undefined),
    };
    storageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      listParts: jest.fn().mockResolvedValue([]),
      presignUploadPart: jest
        .fn()
        .mockImplementation((_key: string, _id: string, n: number) =>
          Promise.resolve(`https://minio/part-${n}`),
        ),
    };
    service = new VideoUploadsService(
      channelsService as unknown as ChannelsService,
      videosRepository as unknown as VideosRepository,
      storageService as unknown as StorageService,
      config,
    );
  });

  describe('initiate', () => {
    it('should create the draft in the channel of the user and open the multipart', async () => {
      const result = await service.initiate('user-1', validDto);

      expect(channelsService.findByUserId).toHaveBeenCalledWith('user-1');
      expect(videosRepository.createDraft).toHaveBeenCalledWith({
        channelId: 'channel-1',
        title: 'My Holiday',
        extension: 'mp4',
      });
      expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
        draft.video_key,
        'video/mp4',
      );
      expect(videosRepository.setUploadId).toHaveBeenCalledWith(
        'video-1',
        'upload-1',
      );
      expect(result).toEqual({
        public_id: 'abcdefghijk',
        status: 'draft',
        part_size_bytes: 67_108_864,
        part_count: 3,
      });
    });

    it.each([
      [1, 1],
      [67_108_864, 1],
      [67_108_865, 2],
      [10_737_418_240, 160],
    ])(
      'should report ceil(size / part size) parts (%d bytes -> %d)',
      async (size, parts) => {
        const result = await service.initiate('user-1', {
          ...validDto,
          size_bytes: size,
        });

        expect(result.part_count).toBe(parts);
      },
    );

    it('should accept the maximum size and reject one byte above it', async () => {
      await expect(
        service.initiate('user-1', { ...validDto, size_bytes: 10_737_418_240 }),
      ).resolves.toBeDefined();

      await expect(
        service.initiate('user-1', { ...validDto, size_bytes: 10_737_418_241 }),
      ).rejects.toBeInstanceOf(VideoTooLargeException);
    });

    it('should accept an uppercase extension and content type', async () => {
      await service.initiate('user-1', {
        ...validDto,
        filename: 'CLIP.MOV',
        content_type: 'Video/QuickTime',
      });

      expect(videosRepository.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'CLIP', extension: 'mov' }),
      );
    });

    it.each([
      ['an extension outside the allowlist', 'a.exe', 'video/mp4'],
      ['a content type outside the allowlist', 'a.mp4', 'application/pdf'],
      ['an extension incoherent with the content type', 'a.mkv', 'video/mp4'],
      ['a file name without extension', 'video', 'video/mp4'],
    ])('should reject %s', async (_label, filename, contentType) => {
      await expect(
        service.initiate('user-1', {
          ...validDto,
          filename,
          content_type: contentType,
        }),
      ).rejects.toBeInstanceOf(UnsupportedVideoFormatException);
      expect(videosRepository.createDraft).not.toHaveBeenCalled();
    });

    it('should not create anything when the user has no channel', async () => {
      channelsService.findByUserId.mockResolvedValue(null);

      await expect(service.initiate('user-1', validDto)).rejects.toBeInstanceOf(
        ChannelNotFoundException,
      );
      expect(videosRepository.createDraft).not.toHaveBeenCalled();
      expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('should fall back to a default title and cap long titles', async () => {
      await service.initiate('user-1', { ...validDto, filename: '.mp4' });
      await service.initiate('user-1', {
        ...validDto,
        filename: `${'x'.repeat(150)}.mp4`,
      });

      const titles = (
        videosRepository.createDraft.mock.calls as [{ title: string }][]
      ).map(([input]) => input.title);
      expect(titles[0]).toBe('Untitled video');
      expect(titles[1]).toHaveLength(100);
    });

    it('should remove the draft and rethrow when the storage fails', async () => {
      storageService.createMultipartUpload.mockRejectedValue(
        new StorageUnavailableException(),
      );

      await expect(service.initiate('user-1', validDto)).rejects.toBeInstanceOf(
        StorageUnavailableException,
      );
      expect(videosRepository.deleteById).toHaveBeenCalledWith('video-1');
      expect(storageService.abortMultipartUpload).not.toHaveBeenCalled();
    });

    it('should abort the multipart and remove the draft when saving the upload id fails', async () => {
      const failure = new Error('db down');
      videosRepository.setUploadId.mockRejectedValue(failure);

      await expect(service.initiate('user-1', validDto)).rejects.toBe(failure);
      expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
        draft.video_key,
        'upload-1',
      );
      expect(videosRepository.deleteById).toHaveBeenCalledWith('video-1');
    });

    it('should still remove the draft and rethrow the original error when the abort fails', async () => {
      const failure = new Error('db down');
      videosRepository.setUploadId.mockRejectedValue(failure);
      storageService.abortMultipartUpload.mockRejectedValue(
        new StorageUnavailableException(),
      );

      await expect(service.initiate('user-1', validDto)).rejects.toBe(failure);
      expect(videosRepository.deleteById).toHaveBeenCalledWith('video-1');
    });
  });

  describe('getUploadSession', () => {
    const ownedVideo = {
      ...draft,
      channel_id: 'channel-1',
      upload_id: 'upload-1',
      upload_completed_at: null,
    } as Video;

    beforeEach(() => {
      videosRepository.findByPublicId.mockResolvedValue(ownedVideo);
    });

    it('should list the parts already in the storage for the owner', async () => {
      storageService.listParts.mockResolvedValue([
        { partNumber: 1, sizeBytes: 5, etag: '"a"' },
        { partNumber: 2, sizeBytes: 5, etag: '"b"' },
      ]);

      const session = await service.getUploadSession('user-1', 'abcdefghijk');

      expect(storageService.listParts).toHaveBeenCalledWith(
        ownedVideo.video_key,
        'upload-1',
      );
      expect(session).toEqual({
        public_id: 'abcdefghijk',
        status: 'draft',
        upload_completed: false,
        part_size_bytes: 67_108_864,
        uploaded_parts: [
          { part_number: 1, size_bytes: 5 },
          { part_number: 2, size_bytes: 5 },
        ],
      });
    });

    it('should not list parts once the upload is completed', async () => {
      videosRepository.findByPublicId.mockResolvedValue({
        ...ownedVideo,
        status: VideoStatus.PROCESSING,
        upload_completed_at: new Date(),
      });

      const session = await service.getUploadSession('user-1', 'abcdefghijk');

      expect(session.upload_completed).toBe(true);
      expect(session.uploaded_parts).toEqual([]);
      expect(storageService.listParts).not.toHaveBeenCalled();
    });

    it('should throw VideoNotFoundException for an unknown public_id', async () => {
      videosRepository.findByPublicId.mockResolvedValue(null);

      await expect(
        service.getUploadSession('user-1', 'aaaaaaaaaaa'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('should deny a user whose channel does not own the video', async () => {
      channelsService.findByUserId.mockResolvedValue({
        id: 'channel-2',
      } as Channel);

      await expect(
        service.getUploadSession('user-2', 'abcdefghijk'),
      ).rejects.toBeInstanceOf(VideoAccessDeniedException);
      expect(storageService.listParts).not.toHaveBeenCalled();
    });

    it('should deny a user without a channel', async () => {
      channelsService.findByUserId.mockResolvedValue(null);

      await expect(
        service.getUploadSession('user-3', 'abcdefghijk'),
      ).rejects.toBeInstanceOf(VideoAccessDeniedException);
    });

    it('should propagate a storage failure', async () => {
      storageService.listParts.mockRejectedValue(
        new StorageUnavailableException(),
      );

      await expect(
        service.getUploadSession('user-1', 'abcdefghijk'),
      ).rejects.toBeInstanceOf(StorageUnavailableException);
    });
  });

  describe('requestPartUrls', () => {
    const ownedVideo = {
      ...draft,
      channel_id: 'channel-1',
      upload_id: 'upload-1',
      upload_completed_at: null,
    } as Video;

    beforeEach(() => {
      videosRepository.findByPublicId.mockResolvedValue(ownedVideo);
    });

    it('should presign each requested part for one hour', async () => {
      const result = await service.requestPartUrls('user-1', 'abcdefghijk', {
        part_numbers: [1, 2],
      });

      expect(storageService.presignUploadPart).toHaveBeenCalledWith(
        ownedVideo.video_key,
        'upload-1',
        1,
        3600,
      );
      expect(storageService.presignUploadPart).toHaveBeenCalledWith(
        ownedVideo.video_key,
        'upload-1',
        2,
        3600,
      );
      expect(result).toEqual({
        parts: [
          { part_number: 1, url: 'https://minio/part-1' },
          { part_number: 2, url: 'https://minio/part-2' },
        ],
        expires_in: 3600,
      });
    });

    it('should refuse once the upload is completed', async () => {
      videosRepository.findByPublicId.mockResolvedValue({
        ...ownedVideo,
        upload_completed_at: new Date(),
      });

      await expect(
        service.requestPartUrls('user-1', 'abcdefghijk', { part_numbers: [1] }),
      ).rejects.toBeInstanceOf(UploadAlreadyCompletedException);
      expect(storageService.presignUploadPart).not.toHaveBeenCalled();
    });

    it('should deny a user who is not the owner', async () => {
      channelsService.findByUserId.mockResolvedValue({
        id: 'channel-2',
      } as Channel);

      await expect(
        service.requestPartUrls('user-2', 'abcdefghijk', { part_numbers: [1] }),
      ).rejects.toBeInstanceOf(VideoAccessDeniedException);
      expect(storageService.presignUploadPart).not.toHaveBeenCalled();
    });

    it('should throw VideoNotFoundException for an unknown public_id', async () => {
      videosRepository.findByPublicId.mockResolvedValue(null);

      await expect(
        service.requestPartUrls('user-1', 'aaaaaaaaaaa', { part_numbers: [1] }),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('should propagate a storage failure', async () => {
      storageService.presignUploadPart.mockRejectedValue(
        new StorageUnavailableException(),
      );

      await expect(
        service.requestPartUrls('user-1', 'abcdefghijk', { part_numbers: [1] }),
      ).rejects.toBeInstanceOf(StorageUnavailableException);
    });
  });
});
