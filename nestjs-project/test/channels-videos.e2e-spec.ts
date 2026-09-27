import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import { VideoVisibility } from '../src/videos/video-visibility.enum';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';

interface Page {
  items: Record<string, unknown>[];
  total: number;
  error?: string;
}

const HOUR = 60 * 60 * 1000;

describe('channels-videos', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let channel: Channel;
  let olderPublic: Video;
  let newerPublic: Video;
  let unlisted: Video;
  let draft: Video;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
    await registerConfirmAndLogin(app, 'owner-a@example.com');
    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: 'owner-a@example.com' });
    channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: user.id });
    // Ready videos seeded on the row (the worker and the publication do not
    // run here).
    const seed = (
      publicId: string,
      publishedAt: Date | null,
      visibility = VideoVisibility.PUBLIC,
    ) =>
      dataSource.getRepository(Video).save({
        public_id: publicId,
        channel_id: channel.id,
        title: publicId,
        status: VideoStatus.READY,
        duration_seconds: 12.5,
        visibility,
        published_at: publishedAt,
        video_key: `${channel.id}/${publicId}/source.mp4`,
      });
    olderPublic = await seed('olderpublic', new Date(Date.now() - 2 * HOUR));
    newerPublic = await seed('newerpublic', new Date(Date.now() - HOUR));
    unlisted = await seed('unlistedvid', new Date(), VideoVisibility.UNLISTED);
    draft = await seed('draftvideo1', null);
  });

  const list = (nickname: string, query = '') =>
    request(app.getHttpServer()).get(`/channels/${nickname}/videos${query}`);

  // 1. Listar os vídeos públicos do canal

  it('anonimo-lista-publicos-por-publicacao', async () => {
    const res = await list(channel.nickname).expect(200);

    const body = res.body as Page;
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.public_id)).toEqual([
      newerPublic.public_id,
      olderPublic.public_id,
    ]);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([
        'duration_seconds',
        'public_id',
        'published_at',
        'thumbnail_url',
        'title',
      ]);
    }
  });

  it('unlisted-e-rascunho-ficam-de-fora', async () => {
    const res = await list(channel.nickname).expect(200);

    const ids = (res.body as Page).items.map((item) => item.public_id);
    expect(ids).not.toContain(unlisted.public_id);
    expect(ids).not.toContain(draft.public_id);
    await request(app.getHttpServer())
      .get(`/videos/${unlisted.public_id}`)
      .expect(200);
  });

  it('canal-inexistente', async () => {
    const res = await list('inexistente').expect(404);

    expect((res.body as Page).error).toBe('CHANNEL_NOT_FOUND');
  });

  it('paginacao-invalida', async () => {
    const res = await list(channel.nickname, '?limit=0').expect(400);

    expect((res.body as Page).error).toBe('VALIDATION_ERROR');
  });

  it('rota-publica-nao-recebe-429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await list(channel.nickname)).status);
    }

    expect(new Set(statuses)).toEqual(new Set([200]));
  });
});
