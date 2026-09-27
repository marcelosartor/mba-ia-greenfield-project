import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Category } from '../categories/entities/category.entity';
import { ChannelsModule } from '../channels/channels.module';
import { Channel } from '../channels/entities/channel.entity';
import { VideoNotPublishableException } from '../common/exceptions/domain.exception';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoOwnershipService } from './video-ownership.service';
import { VideoPublicationService } from './video-publication.service';
import { VideoStatus } from './video-status.enum';
import { VideosRepositoryModule } from './videos-repository.module';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  Category,
];

describe('VideoPublicationService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideoPublicationService;
  let channel: Channel;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosRepositoryModule,
        ChannelsModule,
      ],
      providers: [VideoOwnershipService, VideoPublicationService],
    }).compile();
    dataSource = module.get(DataSource);
    service = module.get(VideoPublicationService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'publisher@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Publisher', nickname: 'publisher', user_id: user.id });
  });

  const insertVideo = (publicId: string, status: VideoStatus) =>
    dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      title: 'To publish',
      status,
      video_key: `${channel.id}/${publicId}/source.mp4`,
    });

  it('should write a newer published_at when a published video is published again', async () => {
    await insertVideo('publishme01', VideoStatus.READY);

    const first = await service.publish(channel.user_id, 'publishme01');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await service.publish(channel.user_id, 'publishme01');

    expect(first.published_at).toBeInstanceOf(Date);
    expect(second.published_at!.getTime()).toBeGreaterThan(
      first.published_at!.getTime(),
    );
  });

  it('should not publish a video that is still processing', async () => {
    const stored = await insertVideo('processing1', VideoStatus.PROCESSING);

    await expect(
      service.publish(channel.user_id, 'processing1'),
    ).rejects.toBeInstanceOf(VideoNotPublishableException);
    expect(
      (await dataSource.getRepository(Video).findOneByOrFail({ id: stored.id }))
        .published_at,
    ).toBeNull();
  });
});
