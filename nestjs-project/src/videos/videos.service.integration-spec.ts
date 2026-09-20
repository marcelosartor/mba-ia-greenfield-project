import { Test, type TestingModule } from '@nestjs/testing';
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
import { VideosRepositoryModule } from './videos-repository.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

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
      ],
      providers: [VideosService],
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

  it('should resolve a ready video by public_id, with numbers read back as numbers', async () => {
    await insertVideo('readyvideo1', {
      status: VideoStatus.READY,
      duration_seconds: 12.5,
      width: 640,
      height: 360,
    });

    const result = await service.getReadyVideo('readyvideo1');

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

  it('should tell apart an unknown public_id from a video that is not ready', async () => {
    await insertVideo('processing1', { status: VideoStatus.PROCESSING });

    await expect(service.getReadyVideo('processing1')).rejects.toBeInstanceOf(
      VideoNotReadyException,
    );
    await expect(service.getReadyVideo('doesnotexis')).rejects.toBeInstanceOf(
      VideoNotFoundException,
    );
  });

  it('should resolve the video by public_id only, never by the internal id', async () => {
    const stored = await insertVideo('readyvideo2', {
      status: VideoStatus.READY,
    });

    await expect(service.getReadyVideo(stored.id)).rejects.toBeInstanceOf(
      VideoNotFoundException,
    );
  });
});
