import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import { VideoVisibility } from '../src/videos/video-visibility.enum';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';
import { discardStoredUploads } from './helpers/video-e2e';

interface VideoBody {
  title: string;
  description: string | null;
  category: { slug: string; name: string } | null;
  visibility: string;
  published_at: string | null;
  updated_at: string;
  error?: string;
}

describe('videos-update', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let tokenA: string;
  let tokenB: string;
  let publicId: string;

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
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'a.mp4', content_type: 'video/mp4', size_bytes: 1000 })
      .expect(201);
    publicId = (res.body as { public_id: string }).public_id;
  });

  afterEach(async () => {
    await discardStoredUploads(
      storage,
      await dataSource.getRepository(Video).find(),
    );
  });

  const row = () =>
    dataSource.getRepository(Video).findOneByOrFail({ public_id: publicId });

  const patch = (body: object, token: string | null = tokenA) => {
    const req = request(app.getHttpServer())
      .patch(`/videos/${publicId}`)
      .send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  // 1. Editar as informações do vídeo

  it('dono-edita-titulo-e-categoria', async () => {
    const before = await row();

    const res = await patch({
      title: '  Novo título  ',
      category: 'musica',
    }).expect(200);

    const body = res.body as VideoBody;
    expect(body.title).toBe('Novo título');
    expect(body.category).toEqual({ slug: 'musica', name: 'Música' });
    expect(new Date(body.updated_at).getTime()).toBeGreaterThan(
      before.updated_at.getTime(),
    );
    const after = await row();
    expect(after.title).toBe('Novo título');
    expect(after.category_id).not.toBeNull();
    expect(after.status).toBe(before.status);
    expect(after.thumbnail_key).toBe(before.thumbnail_key);
  });

  it('null-limpa-descricao-sem-mexer-no-resto', async () => {
    const first = await patch({ description: 'Texto' }).expect(200);
    const second = await patch({ description: null }).expect(200);

    expect((second.body as VideoBody).description).toBeNull();
    expect((second.body as VideoBody).title).toBe(
      (first.body as VideoBody).title,
    );
  });

  it('corpo-vazio-e-campos-proibidos', async () => {
    const empty = await patch({}).expect(400);
    expect((empty.body as VideoBody).error).toBe('VALIDATION_ERROR');

    const before = await row();
    for (const body of [
      { status: 'ready' },
      { video_key: 'x' },
      { channel_id: '00000000-0000-0000-0000-000000000000' },
    ]) {
      const res = await patch(body).expect(400);
      expect((res.body as VideoBody).error).toBe('VALIDATION_ERROR');
    }
    expect(await row()).toEqual(before);
  });

  it('titulo-fora-das-regras', async () => {
    for (const title of ['   ', 'x'.repeat(101)]) {
      const res = await patch({ title }).expect(400);
      expect((res.body as VideoBody).error).toBe('VALIDATION_ERROR');
    }

    await patch({ title: 'x'.repeat(100) }).expect(200);
  });

  it('categoria-inexistente', async () => {
    const res = await patch({ category: 'inexistente' }).expect(400);

    expect((res.body as VideoBody).error).toBe('INVALID_CATEGORY');
    expect((await row()).category_id).toBeNull();
  });

  it('autorizacao-e-inexistente', async () => {
    const other = await patch({ title: 'Invasão' }, tokenB).expect(403);
    expect((other.body as VideoBody).error).toBe('VIDEO_ACCESS_DENIED');
    expect((await row()).title).not.toBe('Invasão');

    await patch({ title: 'Invasão' }, null).expect(401);

    const missing = await request(app.getHttpServer())
      .patch('/videos/aaaaaaaaaaa')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'X' })
      .expect(404);
    expect((missing.body as VideoBody).error).toBe('VIDEO_NOT_FOUND');
  });

  it('visibilidade-nao-altera-publicacao', async () => {
    await dataSource.getRepository(Video).update(
      { public_id: publicId },
      {
        status: VideoStatus.READY,
        published_at: new Date(),
        visibility: VideoVisibility.PUBLIC,
      },
    );
    const publishedAt = (await row()).published_at;

    const res = await patch({ visibility: 'unlisted' }).expect(200);

    const body = res.body as VideoBody;
    expect(body.visibility).toBe('unlisted');
    expect(new Date(body.published_at!).getTime()).toBe(publishedAt!.getTime());
  });
});
