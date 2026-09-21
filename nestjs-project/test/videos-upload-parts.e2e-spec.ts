import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';
import {
  discardStoredUploads,
  putPart,
  uploadParts,
} from './helpers/video-e2e';

const PART_SIZE = 5_242_880;

interface PartsBody {
  parts: { part_number: number; url: string }[];
  expires_in: number;
}

describe('POST /videos/:public_id/upload/parts (e2e)', () => {
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
        size_bytes: 6_000_000,
      })
      .expect(201);
    video = await dataSource.getRepository(Video).findOneByOrFail({
      public_id: (created.body as { public_id: string }).public_id,
    });
  });

  afterEach(async () => {
    await discardStoredUploads(
      storage,
      await dataSource.getRepository(Video).find(),
    );
  });

  const requestParts = (
    partNumbers: unknown,
    token: string | null = tokenA,
  ) => {
    const req = request(app.getHttpServer()).post(
      `/videos/${video.public_id}/upload/parts`,
    );
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send({
      part_numbers: partNumbers,
    });
  };

  it('should issue presigned URLs for the requested parts', async () => {
    const res = await requestParts([1, 2]).expect(201);

    const body = res.body as PartsBody;
    expect(body.parts.map((part) => part.part_number)).toEqual([1, 2]);
    expect(body.parts.every((part) => part.url.length > 0)).toBe(true);
    expect(body.expires_in).toBe(3600);
  });

  it('should let the client PUT a part straight to the storage', async () => {
    const res = await requestParts([1]).expect(201);
    const { url } = (res.body as PartsBody).parts[0];

    expect(new URL(url).hostname).toBe('minio');
    await expect(putPart(url, PART_SIZE)).resolves.toBeTruthy();
  });

  it('should refuse new URLs after the upload is completed', async () => {
    await uploadParts(app, tokenA, video.public_id, {
      1: PART_SIZE,
      2: 6_000_000 - PART_SIZE,
    });
    await request(app.getHttpServer())
      .post(`/videos/${video.public_id}/upload/completion`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(202);

    const res = await requestParts([1]).expect(409);

    expect((res.body as { error: string }).error).toBe(
      'UPLOAD_ALREADY_COMPLETED',
    );
  });

  it('should reject an invalid part_numbers', async () => {
    await requestParts([]).expect(400);
    await requestParts(Array.from({ length: 101 }, (_, i) => i + 1)).expect(
      400,
    );
    await requestParts([1, 1]).expect(400);
    await requestParts([0]).expect(400);
    await requestParts([10_001]).expect(400);
    await requestParts(['1']).expect(400);
  });

  it('should forbid a user who is not the owner', async () => {
    const res = await requestParts([1], tokenB).expect(403);

    expect((res.body as { error: string }).error).toBe('VIDEO_ACCESS_DENIED');
  });

  it('should reject an anonymous request', async () => {
    await requestParts([1], null).expect(401);
  });
});
