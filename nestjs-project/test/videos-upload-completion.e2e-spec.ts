import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { QUEUE_NAMES } from '../src/queue/queue.constants';
import { VideoProcessingPublisher } from '../src/queue/video-processing.publisher';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';
import { discardStoredUploads, uploadParts } from './helpers/video-e2e';

const PART_SIZE = 5_242_880;
const ALL_PARTS = { 1: PART_SIZE, 2: PART_SIZE, 3: 1_514_240 };

interface CompletionBody {
  public_id: string;
  status: string;
  upload_completed: boolean;
}

describe('POST /videos/:public_id/upload/completion (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let queue: Queue;
  let tokenA: string;
  let tokenB: string;
  let video: Video;

  beforeAll(async () => {
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES = String(PART_SIZE);
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    queue = app.get<Queue>(getQueueToken(QUEUE_NAMES.VIDEO_PROCESSING));
  });

  afterAll(async () => {
    delete process.env.VIDEO_UPLOAD_PART_SIZE_BYTES;
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
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
    video = await dataSource.getRepository(Video).findOneByOrFail({
      public_id: (created.body as { public_id: string }).public_id,
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await discardStoredUploads(
      storage,
      await dataSource.getRepository(Video).find(),
    );
  });

  const complete = (token: string | null = tokenA) => {
    const req = request(app.getHttpServer()).post(
      `/videos/${video.public_id}/upload/completion`,
    );
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const reloadVideo = (): Promise<Video | null> =>
    dataSource.getRepository(Video).findOneBy({ id: video.id });

  it('should complete the upload and queue the processing job', async () => {
    await uploadParts(app, tokenA, video.public_id, ALL_PARTS);

    const res = await complete().expect(202);

    const body = res.body as CompletionBody;
    expect(body.upload_completed).toBe(true);
    expect(body.status).toBe('draft');
    const stored = await reloadVideo();
    expect(stored?.upload_completed_at).toBeInstanceOf(Date);
    expect(stored?.upload_id).toBeNull();
    const head = await storage.headObject(
      storage.videosBucket,
      video.video_key,
    );
    expect(head.contentLength).toBe(12_000_000);
    const job = await queue.getJob(video.id);
    expect(job?.id).toBe(video.id);
    expect(job?.data).toEqual({ videoId: video.id });
  });

  it('should answer 202 again without queuing a second job', async () => {
    await uploadParts(app, tokenA, video.public_id, ALL_PARTS);
    const first = await complete().expect(202);

    const second = await complete().expect(202);

    expect(second.body).toEqual(first.body);
    expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 1 });
  });

  it('should refuse a missing intermediate part', async () => {
    await uploadParts(app, tokenA, video.public_id, {
      1: PART_SIZE,
      3: 1_514_240,
    });

    const res = await complete().expect(409);

    expect((res.body as { error: string }).error).toBe('UPLOAD_INCOMPLETE');
    expect((await reloadVideo())?.upload_completed_at).toBeNull();
    expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 0 });
  });

  it('should reject parts that add up to more than 10 GiB and discard the draft', async () => {
    jest.spyOn(storage, 'listParts').mockResolvedValue([
      { partNumber: 1, sizeBytes: 6 * 1024 ** 3, etag: '"a"' },
      { partNumber: 2, sizeBytes: 5 * 1024 ** 3, etag: '"b"' },
    ]);

    const res = await complete().expect(413);

    expect((res.body as { error: string }).error).toBe('VIDEO_TOO_LARGE');
    expect(await reloadVideo()).toBeNull();
    expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 0 });
  });

  it('should answer 202 when the queue is unavailable', async () => {
    await uploadParts(app, tokenA, video.public_id, ALL_PARTS);
    jest
      .spyOn(app.get(VideoProcessingPublisher), 'publish')
      .mockRejectedValue(new Error('redis unavailable'));

    await complete().expect(202);

    const stored = await reloadVideo();
    expect(stored?.status).toBe('draft');
    expect(stored?.upload_completed_at).toBeInstanceOf(Date);
  });

  it('should forbid a user who is not the owner and reject anonymous calls', async () => {
    const forbidden = await complete(tokenB).expect(403);
    expect((forbidden.body as { error: string }).error).toBe(
      'VIDEO_ACCESS_DENIED',
    );

    await complete(null).expect(401);
  });

  it('should answer 404 for an unknown public_id', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos/aaaaaaaaaaa/upload/completion')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });
});
