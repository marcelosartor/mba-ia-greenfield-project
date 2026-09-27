import { DataSource, Repository } from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus } from '../video-status.enum';
import { Video } from './video.entity';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  Category,
];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channel: Channel;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'video_owner@example.com', password: 'hashed' });
    channel = await dataSource.getRepository(Channel).save({
      name: 'Video Owner',
      nickname: 'videoowner',
      user_id: user.id,
    });
  });

  const newVideo = (overrides: Partial<Video> = {}): Video =>
    videoRepository.create({
      public_id: 'abcdefghijk',
      channel_id: channel.id,
      title: 'My video',
      video_key: `${channel.id}/some-id/source.mp4`,
      ...overrides,
    });

  it('should default a new video to draft with empty processing fields', async () => {
    const saved = await videoRepository.save(newVideo());

    const found = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(found.status).toBe(VideoStatus.DRAFT);
    expect(found.upload_completed_at).toBeNull();
    expect(found.duration_seconds).toBeNull();
    expect(found.thumbnail_key).toBeNull();
    expect(found.created_at).toBeInstanceOf(Date);
    expect(found.updated_at).toBeInstanceOf(Date);
  });

  it('should enforce unique public_id', async () => {
    await videoRepository.save(newVideo());

    await expect(
      videoRepository.save(newVideo({ video_key: 'other/key/source.mp4' })),
    ).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'UQ_videos_public_id' },
    });
  });

  it('should reject a status outside the allowed values', async () => {
    await expect(
      videoRepository.save(newVideo({ status: 'published' as VideoStatus })),
    ).rejects.toMatchObject({
      driverError: { code: '23514', constraint: 'CHK_videos_status' },
    });
  });

  it('should reject a video whose channel does not exist', async () => {
    await expect(
      videoRepository.save(
        newVideo({ channel_id: '00000000-0000-4000-8000-000000000000' }),
      ),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });

  it('should read numeric and bigint columns back as numbers', async () => {
    const saved = await videoRepository.save(
      newVideo({
        duration_seconds: 12.345,
        bit_rate: 4_000_000,
        size_bytes: 10 * 1024 ** 3,
      }),
    );

    const found = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(found.duration_seconds).toBe(12.345);
    expect(found.bit_rate).toBe(4_000_000);
    expect(found.size_bytes).toBe(10 * 1024 ** 3);
  });

  it('should load the videos of a channel through the inverse relation', async () => {
    await videoRepository.save(newVideo());

    const loaded = await dataSource.getRepository(Channel).findOneOrFail({
      where: { id: channel.id },
      relations: { videos: true },
    });

    expect(loaded.videos).toHaveLength(1);
    expect(loaded.videos[0].public_id).toBe('abcdefghijk');
  });

  describe('Phase 04 columns', () => {
    it('should default visibility to public, with no publication, description, category or custom cover', async () => {
      const saved = await videoRepository.save(newVideo());

      const found = await videoRepository.findOneByOrFail({ id: saved.id });
      expect(found.visibility).toBe('public');
      expect(found.published_at).toBeNull();
      expect(found.description).toBeNull();
      expect(found.category_id).toBeNull();
      expect(found.custom_thumbnail_key).toBeNull();
    });

    it('should reject a visibility other than public or unlisted (CHK_videos_visibility)', async () => {
      await expect(
        videoRepository.save(
          newVideo({ visibility: 'private' as Video['visibility'] }),
        ),
      ).rejects.toMatchObject({
        driverError: { constraint: 'CHK_videos_visibility' },
      });
    });

    it('should reject published_at on a video that is not ready (CHK_videos_published_ready)', async () => {
      await expect(
        videoRepository.save(
          newVideo({
            status: VideoStatus.PROCESSING,
            published_at: new Date(),
          }),
        ),
      ).rejects.toMatchObject({
        driverError: { constraint: 'CHK_videos_published_ready' },
      });
    });

    it('should accept published_at on a ready video', async () => {
      const saved = await videoRepository.save(
        newVideo({ status: VideoStatus.READY, published_at: new Date() }),
      );

      expect(
        (await videoRepository.findOneByOrFail({ id: saved.id })).published_at,
      ).toBeInstanceOf(Date);
    });

    it('should reject a category_id that does not exist (foreign key)', async () => {
      await expect(
        videoRepository.save(
          newVideo({ category_id: '00000000-0000-0000-0000-000000000000' }),
        ),
      ).rejects.toMatchObject({ driverError: { code: '23503' } });
    });
  });
});
