import type { S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Category } from '../../categories/entities/category.entity';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { generateImage } from '../../test/image-fixtures';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../../test/storage-test-client';
import { digestStream, sha256 } from '../../test/stream-test-utils';
import { User } from '../../users/entities/user.entity';
import { Video } from '../entities/video.entity';
import { ChannelsModule } from '../../channels/channels.module';
import videoConfig from '../../config/video.config';
import { readJpegSize } from '../../test/media-fixtures';
import { VideoAccessService } from '../video-access.service';
import { VideoOwnershipService } from '../video-ownership.service';
import { ImageNormalizerService } from './image-normalizer.service';
import { VideoStatus } from '../video-status.enum';
import { VideosRepositoryModule } from '../videos-repository.module';
import { VideoThumbnailsService } from './video-thumbnails.service';

jest.setTimeout(60000);

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  Category,
];

describe('VideoThumbnailsService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let service: VideoThumbnailsService;
  let cleanupClient: S3Client;
  let channel: Channel;
  const storedKeys: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig, videoConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosRepositoryModule,
        StorageModule,
        ChannelsModule,
      ],
      providers: [
        VideoAccessService,
        VideoOwnershipService,
        ImageNormalizerService,
        VideoThumbnailsService,
      ],
    }).compile();
    dataSource = module.get(DataSource);
    storage = module.get(StorageService);
    service = module.get(VideoThumbnailsService);
    cleanupClient = createStorageTestClient();
  });

  afterAll(async () => {
    for (const key of storedKeys) {
      await deleteStoredObject(cleanupClient, storage.thumbnailsBucket, key);
    }
    cleanupClient.destroy();
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'thumbs@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Thumbs', nickname: 'thumbs', user_id: user.id });
  });

  it('should stream the generated cover stored at {videoId}/default.jpg', async () => {
    const video = await dataSource.getRepository(Video).save({
      public_id: 'thumbvideo1',
      channel_id: channel.id,
      title: 'With cover',
      status: VideoStatus.READY,
      published_at: new Date(),
      video_key: `${channel.id}/thumbvideo1/source.mp4`,
    });
    const key = `${video.id}/default.jpg`;
    const cover = generateImage('jpeg', '640x360');
    storedKeys.push(key);
    await storage.putObject(storage.thumbnailsBucket, key, cover, 'image/jpeg');
    await dataSource
      .getRepository(Video)
      .update({ id: video.id }, { thumbnail_key: key });

    const result = await service.getThumbnail('thumbvideo1', undefined);
    const digest = await digestStream(result.body);

    expect(result.headers['Content-Type']).toBe('image/jpeg');
    expect(result.headers['Content-Length']).toBe(String(cover.length));
    expect(digest.sha256).toBe(sha256(cover));
  });

  it('should normalize a real image, store it in MinIO and record the custom key', async () => {
    const video = await dataSource.getRepository(Video).save({
      public_id: 'thumbvideo2',
      channel_id: channel.id,
      title: 'Custom cover',
      status: VideoStatus.PROCESSING,
      video_key: `${channel.id}/thumbvideo2/source.mp4`,
    });
    const key = `${video.id}/custom.jpg`;
    storedKeys.push(key);

    await service.setCustom(
      channel.user_id,
      'thumbvideo2',
      generateImage('png', '800x600'),
    );

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(row.custom_thumbnail_key).toBe(key);
    const stored = await storage.getObjectRange(storage.thumbnailsBucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stored.body) chunks.push(chunk as Buffer);
    expect(readJpegSize(Buffer.concat(chunks)).width).toBe(640);
  });
});
