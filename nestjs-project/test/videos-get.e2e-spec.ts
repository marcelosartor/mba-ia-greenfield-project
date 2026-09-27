import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Category } from '../src/categories/entities/category.entity';
import { Channel } from '../src/channels/entities/channel.entity';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import { VideoVisibility } from '../src/videos/video-visibility.enum';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';
import { discardStoredUploads } from './helpers/video-e2e';

type VideoChanges = Partial<
  Pick<
    Video,
    | 'status'
    | 'duration_seconds'
    | 'width'
    | 'height'
    | 'published_at'
    | 'visibility'
    | 'description'
    | 'category_id'
  >
>;

describe('videos-get', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let tokenA: string;
  let tokenB: string;

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
  });

  afterEach(async () => {
    await discardStoredUploads(
      storage,
      await dataSource.getRepository(Video).find(),
    );
  });

  const createVideo = async (filename = 'a.mp4'): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename, content_type: 'video/mp4', size_bytes: 1_000_000 })
      .expect(201);
    return (res.body as { public_id: string }).public_id;
  };

  // The worker and the publication are not exercised here: their result is
  // seeded on the row.
  const seed = async (publicId: string, changes: VideoChanges) => {
    const result = await dataSource
      .getRepository(Video)
      .update({ public_id: publicId }, changes);
    expect(result.affected).toBe(1);
  };

  const readyProcessed: VideoChanges = {
    status: VideoStatus.READY,
    duration_seconds: 12.5,
    width: 640,
    height: 360,
  };

  const get = (publicId: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${publicId}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  // 1. Ler os metadados de um vídeo conforme a publicação

  it('anonimo-le-video-publicado-com-contrato-ampliado', async () => {
    const publicId = await createVideo();
    const musica = await dataSource
      .getRepository(Category)
      .findOneByOrFail({ slug: 'musica' });
    await seed(publicId, {
      ...readyProcessed,
      published_at: new Date(),
      visibility: VideoVisibility.PUBLIC,
      description: 'Sobre o vídeo',
      category_id: musica.id,
    });

    const res = await get(publicId).expect(200);

    expect(res.headers['cache-control']).toBe('private, no-cache');
    const body = res.body as Record<string, unknown>;
    expect(body).toMatchObject({
      public_id: publicId,
      description: 'Sobre o vídeo',
      category: { slug: 'musica', name: 'Música' },
      visibility: 'public',
      thumbnail_url: `/videos/${publicId}/thumbnail`,
    });
    expect(typeof body.published_at).toBe('string');
    expect(typeof body.updated_at).toBe('string');
    for (const hidden of [
      'id',
      'channel_id',
      'video_key',
      'thumbnail_key',
      'custom_thumbnail_key',
    ]) {
      expect(body).not.toHaveProperty(hidden);
    }
  });

  it('rascunho-pronto-so-para-o-dono', async () => {
    const publicId = await createVideo();
    await seed(publicId, { ...readyProcessed, published_at: null });

    for (const token of [undefined, tokenB]) {
      const res = await get(publicId, token).expect(404);
      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
    }

    const res = await get(publicId, tokenA).expect(200);
    expect((res.body as { published_at: unknown }).published_at).toBeNull();
  });

  it('video-em-processamento-404-antes-de-409', async () => {
    const publicId = await createVideo();
    await seed(publicId, { status: VideoStatus.PROCESSING });

    const anonymous = await get(publicId).expect(404);
    expect((anonymous.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');

    const owner = await get(publicId, tokenA).expect(409);
    expect((owner.body as { error: string }).error).toBe('VIDEO_NOT_READY');
  });

  it('token-expirado-vale-como-anonimo', async () => {
    const channel = await dataSource
      .getRepository(Channel)
      .findOneOrFail({ where: { user: { email: 'owner-a@example.com' } } });
    const expired = app
      .get(JwtService)
      .sign(
        { sub: channel.user_id, email: 'owner-a@example.com' },
        { expiresIn: -60 },
      );

    const published = await createVideo('published.mp4');
    await seed(published, { ...readyProcessed, published_at: new Date() });
    await get(published, expired).expect(200);

    const draft = await createVideo('draft.mp4');
    await seed(draft, { ...readyProcessed, published_at: null });
    const res = await get(draft, expired).expect(404);
    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('video-inexistente', async () => {
    const res = await get('aaaaaaaaaaa', tokenA).expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });
});
