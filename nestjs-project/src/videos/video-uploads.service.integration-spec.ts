import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  StorageUnavailableException,
  UploadAlreadyCompletedException,
  UploadIncompleteException,
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import redisConfig from '../config/redis.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { VideoProcessingPublisher } from '../queue/video-processing.publisher';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../test/storage-test-client';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideoUploadsService } from './video-uploads.service';
import { VideosModule } from './videos.module';

const PART_SIZE = 5_242_880;

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoUploadsService (integration)', () => {
  let dataSource: DataSource;
  let service: VideoUploadsService;
  let storage: StorageService;
  let publisher: VideoProcessingPublisher;
  let queue: Queue;
  let cleanupClient: S3Client;
  let closeModule: () => Promise<void>;
  let user: User;
  let channel: Channel;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [redisConfig, storageConfig, videoConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    })
      // small parts so a multipart upload with real parts stays cheap
      .overrideProvider(videoConfig.KEY)
      .useValue({
        partSizeBytes: PART_SIZE,
        workerConcurrency: 1,
        processingTimeoutMs: 1_800_000,
      })
      .compile();

    dataSource = module.get(DataSource);
    service = module.get(VideoUploadsService);
    storage = module.get(StorageService);
    publisher = module.get(VideoProcessingPublisher);
    queue = module.get<Queue>(getQueueToken(QUEUE_NAMES.VIDEO_PROCESSING));
    cleanupClient = createStorageTestClient();
    closeModule = () => module.close();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    cleanupClient.destroy();
    await closeModule();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    user = await dataSource
      .getRepository(User)
      .save({ email: 'uploader@example.com', password: 'hashed' });
    channel = await dataSource.getRepository(Channel).save({
      name: 'Uploader',
      nickname: 'uploader',
      user_id: user.id,
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    const videos = await dataSource.getRepository(Video).find();
    for (const video of videos) {
      if (video.upload_id) {
        await storage.abortMultipartUpload(video.video_key, video.upload_id);
      }
      await deleteStoredObject(
        cleanupClient,
        storage.videosBucket,
        video.video_key,
      );
    }
  });

  it('should persist the draft and open a real multipart upload', async () => {
    const result = await service.initiate(user.id, {
      filename: 'holiday.mp4',
      content_type: 'video/mp4',
      size_bytes: 200_000_000,
    });

    expect(result).toMatchObject({
      status: 'draft',
      part_size_bytes: PART_SIZE,
      part_count: 39,
    });
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: result.public_id });
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.channel_id).toBe(channel.id);
    expect(video.title).toBe('holiday');
    expect(video.upload_completed_at).toBeNull();
    expect(video.video_key).toBe(`${channel.id}/${video.id}/source.mp4`);
    expect(video.upload_id).toBeTruthy();
    // listParts fails with NoSuchUpload when the multipart does not exist
    await expect(
      storage.listParts(video.video_key, video.upload_id as string),
    ).resolves.toEqual([]);
  });

  it('should leave no draft behind when the storage is unavailable', async () => {
    jest
      .spyOn(storage, 'createMultipartUpload')
      .mockRejectedValue(new StorageUnavailableException());

    await expect(
      service.initiate(user.id, {
        filename: 'holiday.mp4',
        content_type: 'video/mp4',
        size_bytes: 1000,
      }),
    ).rejects.toBeInstanceOf(StorageUnavailableException);

    expect(await dataSource.getRepository(Video).count()).toBe(0);
  });

  it('should list the parts really uploaded to the storage', async () => {
    const { public_id } = await service.initiate(user.id, {
      filename: 'holiday.mp4',
      content_type: 'video/mp4',
      size_bytes: 200_000_000,
    });
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id });
    for (const [partNumber, size] of [
      [1, 1024],
      [2, 2048],
    ]) {
      const url = await storage.presignUploadPart(
        video.video_key,
        video.upload_id as string,
        partNumber,
      );
      const response = await fetch(url, {
        method: 'PUT',
        body: Buffer.alloc(size),
      });
      expect(response.ok).toBe(true);
    }

    const session = await service.getUploadSession(user.id, public_id);

    expect(session.upload_completed).toBe(false);
    expect(session.uploaded_parts).toEqual([
      { part_number: 1, size_bytes: 1024 },
      { part_number: 2, size_bytes: 2048 },
    ]);
  });

  it('should report a completed upload without listing parts', async () => {
    const { public_id } = await service.initiate(user.id, {
      filename: 'holiday.mp4',
      content_type: 'video/mp4',
      size_bytes: 1000,
    });
    await dataSource
      .getRepository(Video)
      .update({ public_id }, { upload_completed_at: new Date() });

    const session = await service.getUploadSession(user.id, public_id);

    expect(session.upload_completed).toBe(true);
    expect(session.uploaded_parts).toEqual([]);
  });

  it('should deny another user and report an unknown video', async () => {
    const { public_id } = await service.initiate(user.id, {
      filename: 'holiday.mp4',
      content_type: 'video/mp4',
      size_bytes: 1000,
    });
    const other = await dataSource
      .getRepository(User)
      .save({ email: 'other@example.com', password: 'hashed' });
    await dataSource
      .getRepository(Channel)
      .save({ name: 'Other', nickname: 'other', user_id: other.id });

    await expect(
      service.getUploadSession(other.id, public_id),
    ).rejects.toBeInstanceOf(VideoAccessDeniedException);
    await expect(
      service.getUploadSession(user.id, 'aaaaaaaaaaa'),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it('should issue URLs that accept a real part upload', async () => {
    const { public_id } = await service.initiate(user.id, {
      filename: 'holiday.mp4',
      content_type: 'video/mp4',
      size_bytes: 200_000_000,
    });

    const { parts, expires_in } = await service.requestPartUrls(
      user.id,
      public_id,
      { part_numbers: [1, 3] },
    );

    expect(expires_in).toBe(3600);
    expect(parts.map((part) => part.part_number)).toEqual([1, 3]);
    for (const part of parts) {
      expect(new URL(part.url).hostname).toBe('minio');
      const response = await fetch(part.url, {
        method: 'PUT',
        body: Buffer.alloc(512),
      });
      expect(response.ok).toBe(true);
    }
    const session = await service.getUploadSession(user.id, public_id);
    expect(session.uploaded_parts.map((part) => part.part_number)).toEqual([
      1, 3,
    ]);
  });

  it('should refuse new part URLs after the upload was completed', async () => {
    const { public_id } = await service.initiate(user.id, {
      filename: 'holiday.mp4',
      content_type: 'video/mp4',
      size_bytes: 1000,
    });
    await dataSource
      .getRepository(Video)
      .update({ public_id }, { upload_completed_at: new Date() });

    await expect(
      service.requestPartUrls(user.id, public_id, { part_numbers: [1] }),
    ).rejects.toBeInstanceOf(UploadAlreadyCompletedException);
  });

  describe('completeUpload', () => {
    const uploadParts = async (
      public_id: string,
      sizes: Record<number, number>,
    ): Promise<Video> => {
      const numbers = Object.keys(sizes).map(Number);
      const { parts } = await service.requestPartUrls(user.id, public_id, {
        part_numbers: numbers,
      });
      for (const part of parts) {
        const response = await fetch(part.url, {
          method: 'PUT',
          body: Buffer.alloc(sizes[part.part_number]),
        });
        expect(response.ok).toBe(true);
      }
      return dataSource.getRepository(Video).findOneByOrFail({ public_id });
    };

    const initiate = async (sizeBytes: number): Promise<string> =>
      (
        await service.initiate(user.id, {
          filename: 'holiday.mp4',
          content_type: 'video/mp4',
          size_bytes: sizeBytes,
        })
      ).public_id;

    it('should complete a real multipart upload and queue the processing job', async () => {
      const publicId = await initiate(2 * PART_SIZE + 1_000);
      const video = await uploadParts(publicId, {
        1: PART_SIZE,
        2: PART_SIZE,
        3: 1_000,
      });

      const result = await service.completeUpload(user.id, publicId);

      expect(result).toEqual({
        public_id: publicId,
        status: 'draft',
        upload_completed: true,
      });
      const stored = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: video.id });
      expect(stored.upload_completed_at).toBeInstanceOf(Date);
      expect(stored.upload_id).toBeNull();
      expect(stored.status).toBe(VideoStatus.DRAFT);
      const head = await storage.headObject(
        storage.videosBucket,
        video.video_key,
      );
      expect(head.contentLength).toBe(2 * PART_SIZE + 1_000);
      const job = await queue.getJob(video.id);
      expect(job?.data).toEqual({ videoId: video.id });
      expect(job?.name).toBe('process-video');
    });

    it('should be idempotent when the client repeats the confirmation', async () => {
      const publicId = await initiate(1_000);
      const video = await uploadParts(publicId, { 1: 1_000 });

      const first = await service.completeUpload(user.id, publicId);
      const second = await service.completeUpload(user.id, publicId);

      expect(second).toEqual(first);
      expect(await queue.getJobCounts('waiting', 'delayed', 'active')).toEqual({
        waiting: 1,
        delayed: 0,
        active: 0,
      });
      expect(await queue.getJob(video.id)).toBeDefined();
    });

    it('should refuse a missing intermediate part and keep the upload open', async () => {
      const publicId = await initiate(2 * PART_SIZE + 1_000);
      await uploadParts(publicId, { 1: PART_SIZE, 3: 1_000 });

      await expect(
        service.completeUpload(user.id, publicId),
      ).rejects.toBeInstanceOf(UploadIncompleteException);

      const stored = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ public_id: publicId });
      expect(stored.upload_completed_at).toBeNull();
      expect(stored.upload_id).toBeTruthy();
      expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 0 });
    });

    it('should discard the draft and abort the multipart when the parts exceed 10 GiB', async () => {
      const publicId = await initiate(1_000);
      const video = await uploadParts(publicId, { 1: 1_000 });
      jest
        .spyOn(storage, 'listParts')
        .mockResolvedValue([
          { partNumber: 1, sizeBytes: 11 * 1024 ** 3, etag: '"x"' },
        ]);
      const abort = jest.spyOn(storage, 'abortMultipartUpload');

      await expect(
        service.completeUpload(user.id, publicId),
      ).rejects.toBeInstanceOf(VideoTooLargeException);

      expect(abort).toHaveBeenCalledWith(video.video_key, video.upload_id);
      expect(await dataSource.getRepository(Video).count()).toBe(0);
      expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 0 });
    });

    it('should complete even when the job cannot be published', async () => {
      const publicId = await initiate(1_000);
      await uploadParts(publicId, { 1: 1_000 });
      jest
        .spyOn(publisher, 'publish')
        .mockRejectedValue(new Error('redis down'));

      const result = await service.completeUpload(user.id, publicId);

      expect(result.upload_completed).toBe(true);
      const stored = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ public_id: publicId });
      expect(stored.status).toBe(VideoStatus.DRAFT);
      expect(stored.upload_completed_at).toBeInstanceOf(Date);
    });

    it('should complete the upload only once for two simultaneous confirmations', async () => {
      const publicId = await initiate(1_000);
      const video = await uploadParts(publicId, { 1: 1_000 });

      const results = await Promise.all([
        service.completeUpload(user.id, publicId),
        service.completeUpload(user.id, publicId),
      ]);

      expect(results.every((result) => result.upload_completed)).toBe(true);
      expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 1 });
      expect((await queue.getJob(video.id))?.data).toEqual({
        videoId: video.id,
      });
    });
  });
});
