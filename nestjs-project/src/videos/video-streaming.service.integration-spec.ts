import type { S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { InvalidRangeException } from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../test/storage-test-client';
import { digestStream, randomContent, sha256 } from '../test/stream-test-utils';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideoStreamingService } from './video-streaming.service';
import { VideosRepositoryModule } from './videos-repository.module';

jest.setTimeout(120000);

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const MIB = 1024 * 1024;

describe('VideoStreamingService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let service: VideoStreamingService;
  let cleanupClient: S3Client;
  let channel: Channel;
  const storedKeys: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosRepositoryModule,
        StorageModule,
      ],
      providers: [VideoStreamingService],
    }).compile();
    dataSource = module.get(DataSource);
    storage = module.get(StorageService);
    service = module.get(VideoStreamingService);
    cleanupClient = createStorageTestClient();
  });

  afterAll(async () => {
    for (const key of storedKeys) {
      await deleteStoredObject(cleanupClient, storage.videosBucket, key);
    }
    cleanupClient.destroy();
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'streamer@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Streamer', nickname: 'streamer', user_id: user.id });
  });

  let counter = 0;
  /** A ready video whose source object really exists in the storage. */
  const seedReadyVideo = async (content: Buffer): Promise<Video> => {
    const publicId = `stream${String(++counter).padStart(5, '0')}`;
    const video = await dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      title: 'Streamed',
      status: VideoStatus.READY,
      video_key: `test-stream/${publicId}/source.mp4`,
    });
    storedKeys.push(video.video_key);
    await storage.putObject(
      storage.videosBucket,
      video.video_key,
      content,
      'video/mp4',
    );
    return video;
  };

  it('should answer a Range with exactly the bytes asked for', async () => {
    const content = randomContent(3 * MIB);
    const video = await seedReadyVideo(content);

    const result = await service.stream(video.public_id, 'bytes=0-1023');
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) {
      chunks.push(chunk as Buffer);
    }

    expect(result.statusCode).toBe(206);
    expect(result.headers['Content-Range']).toBe(`bytes 0-1023/${3 * MIB}`);
    expect(result.headers['Content-Length']).toBe('1024');
    expect(Buffer.concat(chunks)).toEqual(content.subarray(0, 1024));
  });

  it('should serve an open range and a suffix from the real object', async () => {
    const content = randomContent(MIB);
    const video = await seedReadyVideo(content);

    const open = await service.stream(video.public_id, 'bytes=1048000-');
    const suffix = await service.stream(video.public_id, 'bytes=-100');

    expect((await digestStream(open.body)).sha256).toBe(
      sha256(content.subarray(1_048_000)),
    );
    expect((await digestStream(suffix.body)).sha256).toBe(
      sha256(content.subarray(MIB - 100)),
    );
    expect(open.headers['Content-Range']).toBe(
      `bytes 1048000-${MIB - 1}/${MIB}`,
    );
  });

  it('should serve the whole object without a Range, with the same hash', async () => {
    const content = randomContent(3 * MIB);
    const video = await seedReadyVideo(content);

    const result = await service.stream(video.public_id, undefined);
    const digest = await digestStream(result.body);

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Length']).toBe(String(3 * MIB));
    expect(result.headers['Accept-Ranges']).toBe('bytes');
    expect(result.headers['Content-Type']).toBe('video/mp4');
    expect(result.headers.ETag).toBeTruthy();
    expect(digest.bytes).toBe(3 * MIB);
    expect(digest.sha256).toBe(sha256(content));
  });

  it('should refuse a Range beyond the end of the object', async () => {
    const video = await seedReadyVideo(randomContent(MIB));

    await expect(
      service.stream(video.public_id, 'bytes=9999999-10000000'),
    ).rejects.toBeInstanceOf(InvalidRangeException);
  });

  it('should stream a large object without holding it in memory', async () => {
    const size = 100 * MIB;
    const video = await seedReadyVideo(randomContent(size));

    const result = await service.stream(video.public_id, undefined);
    const digest = await digestStream(result.body);

    expect(digest.bytes).toBe(size);
    expect(digest.peakHeapGrowthBytes).toBeLessThan(50 * MIB);
  });

  it('should not read ahead of a slow consumer (backpressure)', async () => {
    const video = await seedReadyVideo(randomContent(100 * MIB));

    const { body } = await service.stream(video.public_id, undefined);
    const iterator = body[Symbol.asyncIterator]();
    await iterator.next(); // first chunk, then the consumer stalls
    await new Promise((resolve) => setTimeout(resolve, 500));

    // what the API holds is a stream buffer, not the file
    expect(body.readableLength).toBeLessThan(4 * MIB);
    body.destroy();
  });
});
