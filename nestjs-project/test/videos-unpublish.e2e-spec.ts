import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../src/test/storage-test-client';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import { VideoVisibility } from '../src/videos/video-visibility.enum';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';

describe('videos-unpublish', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let tokenA: string;
  let tokenB: string;
  let video: Video;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
    tokenA = await registerConfirmAndLogin(app, 'owner-a@example.com');
    tokenB = await registerConfirmAndLogin(app, 'other-b@example.com');
    const owner = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: 'owner-a@example.com' });
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: owner.id });
    // The worker and the publication do not run here: a published, unlisted
    // ready video is seeded with a small real object.
    video = await dataSource.getRepository(Video).save({
      public_id: 'unpublish01',
      channel_id: channel.id,
      title: 'Published',
      status: VideoStatus.READY,
      published_at: new Date(),
      visibility: VideoVisibility.UNLISTED,
      video_key: `${channel.id}/unpublish01/source.mp4`,
    });
    await storage.putObject(
      storage.videosBucket,
      video.video_key,
      Buffer.from('video bytes'),
      'video/mp4',
    );
  });

  afterEach(async () => {
    const client = createStorageTestClient();
    try {
      await deleteStoredObject(client, storage.videosBucket, video.video_key);
    } finally {
      client.destroy();
    }
  });

  const unpublish = (publicId: string, token: string | null = tokenA) => {
    const req = request(app.getHttpServer()).delete(
      `/videos/${publicId}/publication`,
    );
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const reads = ['', '/stream', '/download'];

  const row = () =>
    dataSource.getRepository(Video).findOneByOrFail({ id: video.id });

  // 1. Despublicar um vídeo

  it('despublica-e-bloqueia-leituras', async () => {
    const res = await unpublish(video.public_id).expect(204);
    expect(res.text).toBe('');
    const after = await row();
    expect(after.published_at).toBeNull();
    expect(after.visibility).toBe(VideoVisibility.UNLISTED);

    for (const suffix of reads) {
      const anonymous = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}${suffix}`)
        .expect(404);
      expect((anonymous.body as { error: string }).error).toBe(
        'VIDEO_NOT_FOUND',
      );
      await request(app.getHttpServer())
        .get(`/videos/${video.public_id}${suffix}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
    }
  });

  it('despublicar-rascunho-e-idempotente', async () => {
    await unpublish(video.public_id).expect(204);
    await unpublish(video.public_id).expect(204);
  });

  it('autorizacao-e-inexistente', async () => {
    const other = await unpublish(video.public_id, tokenB).expect(403);
    expect((other.body as { error: string }).error).toBe('VIDEO_ACCESS_DENIED');
    expect((await row()).published_at).not.toBeNull();

    await unpublish(video.public_id, null).expect(401);

    const missing = await unpublish('aaaaaaaaaaa').expect(404);
    expect((missing.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });
});
