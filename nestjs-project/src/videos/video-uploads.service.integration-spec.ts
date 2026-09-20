import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { StorageUnavailableException } from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideoUploadsService } from './video-uploads.service';
import { VideosModule } from './videos.module';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoUploadsService (integration)', () => {
  let dataSource: DataSource;
  let service: VideoUploadsService;
  let storage: StorageService;
  let closeModule: () => Promise<void>;
  let user: User;
  let channel: Channel;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videoConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();

    dataSource = module.get(DataSource);
    service = module.get(VideoUploadsService);
    storage = module.get(StorageService);
    closeModule = () => module.close();
  });

  afterAll(async () => {
    await closeModule();
  });

  beforeEach(async () => {
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
      part_size_bytes: 67_108_864,
      part_count: 3,
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
});
