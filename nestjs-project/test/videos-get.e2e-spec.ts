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

interface VideoBody {
  public_id: string;
  title: string;
  status: string;
  duration_seconds: number;
  width: number;
  height: number;
  created_at: string;
}

describe('GET /videos/:public_id (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let token: string;

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
    token = await registerConfirmAndLogin(app, 'owner-a@example.com');
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
      .set('Authorization', `Bearer ${token}`)
      .send({
        filename,
        content_type: 'video/mp4',
        size_bytes: 1_000_000,
      })
      .expect(201);
    return (res.body as { public_id: string }).public_id;
  };

  // The worker does not run here: the result of its processing is seeded.
  const seed = async (
    publicId: string,
    changes: Partial<
      Pick<Video, 'status' | 'duration_seconds' | 'width' | 'height'>
    >,
  ): Promise<void> => {
    const result = await dataSource
      .getRepository(Video)
      .update({ public_id: publicId }, changes);
    expect(result.affected).toBe(1);
  };

  it('should let an anonymous caller read a ready video', async () => {
    const publicId = await createVideo('holiday.mp4');
    await seed(publicId, {
      status: VideoStatus.READY,
      duration_seconds: 12.5,
      width: 640,
      height: 360,
    });

    const res = await request(app.getHttpServer())
      .get(`/videos/${publicId}`)
      .expect(200);

    const body = res.body as VideoBody;
    expect(body).toMatchObject({
      public_id: publicId,
      title: 'holiday',
      status: 'ready',
      duration_seconds: 12.5,
      width: 640,
      height: 360,
    });
    expect(new Date(body.created_at).toISOString()).toBe(body.created_at);
    expect(Object.keys(body)).not.toContain('video_key');
  });

  it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.ERROR])(
    'should answer VIDEO_NOT_READY for a video in %s',
    async (status) => {
      const publicId = await createVideo();
      await seed(publicId, { status });

      const res = await request(app.getHttpServer())
        .get(`/videos/${publicId}`)
        .expect(409);

      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
    },
  );

  it('should answer VIDEO_NOT_FOUND for an unknown public_id', async () => {
    const res = await request(app.getHttpServer())
      .get('/videos/aaaaaaaaaaa')
      .expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('should keep the public_id returned by POST /videos after processing', async () => {
    const publicId = await createVideo();
    expect(publicId).toHaveLength(11);
    await seed(publicId, {
      status: VideoStatus.READY,
      duration_seconds: 3,
      width: 320,
      height: 240,
    });

    const res = await request(app.getHttpServer())
      .get(`/videos/${publicId}`)
      .expect(200);

    expect((res.body as VideoBody).public_id).toBe(publicId);
  });

  it('should not let the route swallow the upload session route', async () => {
    const publicId = await createVideo();

    // still authenticated-only: an anonymous call to the sub-resource is 401
    await request(app.getHttpServer())
      .get(`/videos/${publicId}/upload`)
      .expect(401);
  });
});
