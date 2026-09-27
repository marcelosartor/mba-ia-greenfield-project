import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';
import { discardStoredUploads } from './helpers/video-e2e';

interface Body {
  visibility?: string;
  published_at?: string | null;
  error?: string;
}

describe('videos-publish', () => {
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

  // The worker does not run here: the processing status is seeded.
  const createVideo = async (status: VideoStatus): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'a.mp4', content_type: 'video/mp4', size_bytes: 1000 })
      .expect(201);
    const publicId = (res.body as { public_id: string }).public_id;
    await dataSource
      .getRepository(Video)
      .update({ public_id: publicId }, { status });
    return publicId;
  };

  const publish = (
    publicId: string,
    body?: object,
    token: string | null = tokenA,
  ) => {
    let req = request(app.getHttpServer()).post(
      `/videos/${publicId}/publication`,
    );
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };

  const publishedAt = async (publicId: string) =>
    (
      await dataSource
        .getRepository(Video)
        .findOneByOrFail({ public_id: publicId })
    ).published_at;

  // 1. Publicar um vídeo

  it('publica-publico-por-padrao', async () => {
    const publicId = await createVideo(VideoStatus.READY);

    const res = await publish(publicId).expect(200);

    expect((res.body as Body).visibility).toBe('public');
    expect((res.body as Body).published_at).toEqual(expect.any(String));
    await request(app.getHttpServer()).get(`/videos/${publicId}`).expect(200);
  });

  it('publica-como-nao-listado', async () => {
    const publicId = await createVideo(VideoStatus.READY);

    const res = await publish(publicId, { visibility: 'unlisted' }).expect(200);

    expect((res.body as Body).visibility).toBe('unlisted');
    expect((res.body as Body).published_at).toEqual(expect.any(String));
  });

  it('republicar-renova-published-at', async () => {
    const publicId = await createVideo(VideoStatus.READY);
    const first = await publish(publicId).expect(200);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await publish(publicId).expect(200);

    expect(
      new Date((second.body as Body).published_at!).getTime(),
    ).toBeGreaterThan(new Date((first.body as Body).published_at!).getTime());
  });

  it('nao-publica-video-em-processamento', async () => {
    const publicId = await createVideo(VideoStatus.PROCESSING);

    const res = await publish(publicId).expect(409);

    expect((res.body as Body).error).toBe('VIDEO_NOT_PUBLISHABLE');
    expect(await publishedAt(publicId)).toBeNull();
  });

  it('visibilidade-invalida', async () => {
    const publicId = await createVideo(VideoStatus.READY);

    const res = await publish(publicId, { visibility: 'private' }).expect(400);

    expect((res.body as Body).error).toBe('VALIDATION_ERROR');
    expect(await publishedAt(publicId)).toBeNull();
  });

  it('autorizacao', async () => {
    const publicId = await createVideo(VideoStatus.READY);

    const other = await publish(publicId, undefined, tokenB).expect(403);
    expect((other.body as Body).error).toBe('VIDEO_ACCESS_DENIED');
    expect(await publishedAt(publicId)).toBeNull();

    await publish(publicId, undefined, null).expect(401);
  });
});
