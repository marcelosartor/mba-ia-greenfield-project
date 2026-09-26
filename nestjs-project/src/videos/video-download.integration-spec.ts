import type { S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
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

jest.setTimeout(60000);

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const MIB = 1024 * 1024;

describe('VideoStreamingService.download (integration)', () => {
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
      .save({ email: 'downloader@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Downloader', nickname: 'downloader', user_id: user.id });
  });

  const seedReadyVideo = async (
    content: Buffer,
    title: string,
  ): Promise<Video> => {
    const publicId = 'download001';
    const video = await dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      title,
      status: VideoStatus.READY,
      video_key: `test-download/${publicId}/source.mp4`,
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

  it('should stream the file with the same hash as the original', async () => {
    const content = randomContent(2 * MIB);
    const video = await seedReadyVideo(content, 'Meu vídeo: teste/1');

    const result = await service.download(video.public_id);
    const digest = await digestStream(result.body);

    expect(digest.bytes).toBe(2 * MIB);
    expect(digest.sha256).toBe(sha256(content));
    expect(result.headers['Content-Length']).toBe(String(2 * MIB));
    expect(result.headers['Content-Type']).toBe('video/mp4');
    expect(result.headers['Content-Disposition']).toBe(
      `attachment; filename="Meu video teste 1.mp4"; filename*=UTF-8''Meu%20v%C3%ADdeo%20teste%201.mp4`,
    );
  });
});
