import { Test, type TestingModule } from '@nestjs/testing';
import { Category } from '../categories/entities/category.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { CategoriesModule } from '../categories/categories.module';
import { ChannelsModule } from '../channels/channels.module';
import { VideoAccessService } from './video-access.service';
import { VideoOwnershipService } from './video-ownership.service';
import { VideosRepositoryModule } from './videos-repository.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  Category,
];

describe('VideosService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideosService;
  let channel: Channel;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosRepositoryModule,
        ChannelsModule,
        CategoriesModule,
      ],
      providers: [VideoAccessService, VideoOwnershipService, VideosService],
    }).compile();
    dataSource = module.get(DataSource);
    service = module.get(VideosService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'reader@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Reader', nickname: 'reader', user_id: user.id });
  });

  const insertVideo = (
    publicId: string,
    overrides: Partial<Video> = {},
  ): Promise<Video> =>
    dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      title: 'Stored video',
      video_key: `${channel.id}/${publicId}/source.mp4`,
      ...overrides,
    });

  it('should resolve a published video by public_id, with numbers read back as numbers', async () => {
    await insertVideo('readyvideo1', {
      status: VideoStatus.READY,
      published_at: new Date(),
      duration_seconds: 12.5,
      width: 640,
      height: 360,
    });

    const result = await service.getVideo('readyvideo1', undefined);

    expect(result).toMatchObject({
      public_id: 'readyvideo1',
      title: 'Stored video',
      status: 'ready',
      duration_seconds: 12.5,
      width: 640,
      height: 360,
    });
    expect(result.created_at).toBeInstanceOf(Date);
  });

  it('should tell apart, for the owner, an unknown public_id from a video that is not ready', async () => {
    await insertVideo('processing1', { status: VideoStatus.PROCESSING });

    await expect(
      service.getVideo('processing1', channel.user_id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
    await expect(
      service.getVideo('doesnotexis', channel.user_id),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it('should hide a draft from anyone but the owner, loading the owner through the channel', async () => {
    await insertVideo('readydraft1', { status: VideoStatus.READY });

    await expect(
      service.getVideo('readydraft1', undefined),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    await expect(
      service.getVideo('readydraft1', '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    await expect(
      service.getVideo('readydraft1', channel.user_id),
    ).resolves.toMatchObject({ public_id: 'readydraft1', published_at: null });
  });

  it('should resolve the video by public_id only, never by the internal id', async () => {
    const stored = await insertVideo('readyvideo2', {
      status: VideoStatus.READY,
      published_at: new Date(),
    });

    await expect(service.getVideo(stored.id, undefined)).rejects.toBeInstanceOf(
      VideoNotFoundException,
    );
  });

  it('should edit a processing video without touching what the worker writes', async () => {
    const stored = await insertVideo('editvideo01', {
      status: VideoStatus.PROCESSING,
      thumbnail_key: 'thumb/key.jpg',
    });

    const result = await service.update(channel.user_id, 'editvideo01', {
      title: 'Edited',
      category: 'musica',
    });

    expect(result).toMatchObject({
      title: 'Edited',
      category: { slug: 'musica', name: 'Música' },
    });
    expect(new Date(result.updated_at).getTime()).toBeGreaterThan(
      stored.updated_at.getTime(),
    );
    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: stored.id });
    expect(row.status).toBe(VideoStatus.PROCESSING);
    expect(row.thumbnail_key).toBe('thumb/key.jpg');
  });
});
