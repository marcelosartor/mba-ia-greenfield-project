import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';
import { discardStoredUploads, uploadParts } from './helpers/video-e2e';

const PART_SIZE = 5_242_880;

interface SessionBody {
  public_id: string;
  upload_completed: boolean;
  part_size_bytes: number;
  uploaded_parts: { part_number: number; size_bytes: number }[];
}

describe('GET /videos/:public_id/upload (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let tokenA: string;
  let tokenB: string;
  let video: Video;

  beforeAll(async () => {
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES = String(PART_SIZE);
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    delete process.env.VIDEO_UPLOAD_PART_SIZE_BYTES;
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
    tokenA = await registerConfirmAndLogin(app, 'owner-a@example.com');
    tokenB = await registerConfirmAndLogin(app, 'other-b@example.com');
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        filename: 'a.mp4',
        content_type: 'video/mp4',
        size_bytes: 12_000_000,
      })
      .expect(201);
    video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: (created.body as SessionBody).public_id });
  });

  afterEach(async () => {
    await discardStoredUploads(
      storage,
      await dataSource.getRepository(Video).find(),
    );
  });

  const getSession = (publicId: string, token: string | null = tokenA) => {
    const req = request(app.getHttpServer()).get(`/videos/${publicId}/upload`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('should list the parts already uploaded for the owner', async () => {
    await uploadParts(app, tokenA, video.public_id, {
      1: PART_SIZE,
      2: PART_SIZE,
    });

    const res = await getSession(video.public_id).expect(200);

    const body = res.body as SessionBody;
    expect(body.uploaded_parts).toEqual([
      { part_number: 1, size_bytes: PART_SIZE },
      { part_number: 2, size_bytes: PART_SIZE },
    ]);
    expect(body.upload_completed).toBe(false);
    expect(body.part_size_bytes).toBe(PART_SIZE);
  });

  it('should forbid a user who is not the owner', async () => {
    const res = await getSession(video.public_id, tokenB).expect(403);

    expect((res.body as { error: string }).error).toBe('VIDEO_ACCESS_DENIED');
  });

  it('should answer 404 for an unknown public_id', async () => {
    const res = await getSession('aaaaaaaaaaa').expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('should reject an anonymous request', async () => {
    await getSession(video.public_id, null).expect(401);
  });

  it('should not list parts once the upload is completed', async () => {
    await uploadParts(app, tokenA, video.public_id, {
      1: PART_SIZE,
      2: PART_SIZE,
      3: 1_514_240,
    });
    await request(app.getHttpServer())
      .post(`/videos/${video.public_id}/upload/completion`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(202);

    const res = await getSession(video.public_id).expect(200);

    const body = res.body as SessionBody;
    expect(body.upload_completed).toBe(true);
    expect(body.uploaded_parts).toEqual([]);
  });
});
