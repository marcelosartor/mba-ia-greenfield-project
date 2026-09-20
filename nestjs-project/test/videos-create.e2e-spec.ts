import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Channel } from '../src/channels/entities/channel.entity';
import storageConfig from '../src/config/storage.config';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import {
  buildTestingModule,
  createE2eApp,
  registerConfirmAndLogin,
} from './helpers/e2e-app';
import { abortOpenUploads } from './helpers/video-e2e';

interface CreateVideoBody {
  public_id: string;
  status: string;
  part_size_bytes: number;
  part_count: number;
}

const validBody = {
  filename: 'a.mp4',
  content_type: 'video/mp4',
  size_bytes: 200_000_000,
};

describe('POST /videos (e2e)', () => {
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
    await abortOpenUploads(
      storage,
      await dataSource.getRepository(Video).find(),
    );
    await cleanAllTables(dataSource);
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
    token = await registerConfirmAndLogin(app, 'owner-a@example.com');
  });

  afterEach(async () => {
    await abortOpenUploads(
      storage,
      await dataSource.getRepository(Video).find(),
    );
  });

  const postVideo = (body: object, bearer: string | null = token) => {
    const req = request(app.getHttpServer()).post('/videos');
    return (bearer ? req.set('Authorization', `Bearer ${bearer}`) : req).send(
      body,
    );
  };

  const countVideos = (): Promise<number> =>
    dataSource.getRepository(Video).count();

  it('should create the draft and the multipart upload', async () => {
    const res = await postVideo(validBody).expect(201);

    const body = res.body as CreateVideoBody;
    expect(body.public_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(body.status).toBe('draft');
    expect(body.part_size_bytes).toBe(67_108_864);
    expect(body.part_count).toBe(3);

    const rows = await dataSource
      .getRepository(Video)
      .findBy({ public_id: body.public_id });
    expect(rows).toHaveLength(1);
    const ownerChannel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user: { email: 'owner-a@example.com' } });
    expect(rows[0].channel_id).toBe(ownerChannel.id);
    expect(rows[0].status).toBe('draft');
    expect(rows[0].upload_completed_at).toBeNull();
    expect(rows[0].upload_id).toBeTruthy();
    expect(rows[0].video_key).toBe(
      `${rows[0].channel_id}/${rows[0].id}/source.mp4`,
    );
  });

  it('should reject an anonymous request', async () => {
    await postVideo(validBody, null).expect(401);

    expect(await countVideos()).toBe(0);
  });

  it('should reject a size above 10 GiB with VIDEO_TOO_LARGE', async () => {
    const res = await postVideo({
      ...validBody,
      size_bytes: 10_737_418_241,
    }).expect(413);

    expect((res.body as { error: string }).error).toBe('VIDEO_TOO_LARGE');
    expect(await countVideos()).toBe(0);
  });

  it('should reject a format outside the allowlist with UNSUPPORTED_VIDEO_FORMAT', async () => {
    const res = await postVideo({
      ...validBody,
      filename: 'a.exe',
      content_type: 'application/octet-stream',
    }).expect(415);

    expect((res.body as { error: string }).error).toBe(
      'UNSUPPORTED_VIDEO_FORMAT',
    );
    expect(await countVideos()).toBe(0);
  });

  it('should reject a channel_id sent in the body', async () => {
    await postVideo({
      ...validBody,
      channel_id: '00000000-0000-4000-8000-000000000000',
    }).expect(400);

    expect(await countVideos()).toBe(0);
  });

  it('should reject a body that violates the schema', async () => {
    await postVideo({ ...validBody, size_bytes: 0 }).expect(400);
    await postVideo({ filename: 'a.mp4' }).expect(400);

    expect(await countVideos()).toBe(0);
  });

  describe('with the storage unavailable', () => {
    let downApp: INestApplication<App>;

    beforeAll(async () => {
      downApp = await createE2eApp(
        buildTestingModule()
          .overrideProvider(storageConfig.KEY)
          .useFactory({
            factory: () => ({
              ...storageConfig(),
              endpoint: 'http://storage-down:9000',
            }),
          }),
      );
    });

    afterAll(async () => {
      await downApp.close();
    });

    it('should answer STORAGE_UNAVAILABLE and leave no orphan draft', async () => {
      downApp.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
      const res = await request(downApp.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody)
        .expect(502);

      expect((res.body as { error: string }).error).toBe('STORAGE_UNAVAILABLE');
      expect(await countVideos()).toBe(0);
    }, 30000);
  });
});
