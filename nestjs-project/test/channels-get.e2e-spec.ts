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

interface Body {
  name?: string;
  nickname?: string;
  description?: string | null;
  created_at?: string;
  video_count?: number;
  error?: string;
}

describe('channels-get', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tokenA: string;
  let channel: Channel;

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
    tokenA = await registerConfirmAndLogin(app, 'owner-a@example.com');
    await request(app.getHttpServer())
      .patch('/channels/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Canal A', description: 'Sobre o canal' })
      .expect(200);
    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: 'owner-a@example.com' });
    channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: user.id });
  });

  // The worker and the publication do not run here: rows are seeded.
  const seedVideo = (
    publicId: string,
    published: boolean,
    visibility = VideoVisibility.PUBLIC,
  ) =>
    dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      title: publicId,
      status: VideoStatus.READY,
      visibility,
      published_at: published ? new Date() : null,
      video_key: `${channel.id}/${publicId}/source.mp4`,
    });

  const get = (nickname: string) =>
    request(app.getHttpServer()).get(`/channels/${nickname}`);

  // 1. Ler a página pública do canal

  it('anonimo-le-informacoes-do-canal', async () => {
    const res = await get(channel.nickname).expect(200);

    const body = res.body as Body;
    expect(body).toMatchObject({
      name: 'Canal A',
      nickname: channel.nickname,
      description: 'Sobre o canal',
      video_count: 0,
    });
    expect(typeof body.created_at).toBe('string');
    for (const hidden of ['id', 'user_id', 'email']) {
      expect(body).not.toHaveProperty(hidden);
    }
  });

  it('video-count-so-conta-listaveis', async () => {
    await seedVideo('publicvid01', true);
    await seedVideo('unlisted001', true, VideoVisibility.UNLISTED);
    await seedVideo('draftvideo1', false);

    const res = await get(channel.nickname).expect(200);

    expect((res.body as Body).video_count).toBe(1);
  });

  it('canal-inexistente', async () => {
    const res = await get('inexistente').expect(404);

    expect((res.body as Body).error).toBe('CHANNEL_NOT_FOUND');
  });

  it('troca-de-nickname-muda-o-endereco', async () => {
    const oldNickname = channel.nickname;
    await request(app.getHttpServer())
      .patch('/channels/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ nickname: 'canal_novo' })
      .expect(200);

    const old = await get(oldNickname).expect(404);
    expect((old.body as Body).error).toBe('CHANNEL_NOT_FOUND');
    await get('canal_novo').expect(200);
  });

  it('rota-publica-nao-recebe-429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await get(channel.nickname)).status);
    }

    expect(new Set(statuses)).toEqual(new Set([200]));
  });
});
