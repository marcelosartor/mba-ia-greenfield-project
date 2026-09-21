import { S3Client } from '@aws-sdk/client-s3';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { Readable } from 'node:stream';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../src/test/storage-test-client';
import {
  digestStream,
  randomContent,
  sha256,
  type StreamDigest,
} from '../src/test/stream-test-utils';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import { createE2eApp } from './helpers/e2e-app';

const SIZE = 2_097_152;
const TITLE = 'Meu vídeo: teste/1';

describe('GET /videos/:public_id/download (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let cleanupClient: S3Client;
  let channel: Channel;
  let content: Buffer;
  let video: Video;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    cleanupClient = createStorageTestClient();
  });

  afterAll(async () => {
    cleanupClient.destroy();
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'owner-a@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Owner A', nickname: 'ownera', user_id: user.id });
    content = randomContent(SIZE);
    video = await seedVideo(content, VideoStatus.READY);
  });

  afterEach(async () => {
    for (const stored of await dataSource.getRepository(Video).find()) {
      await deleteStoredObject(
        cleanupClient,
        storage.videosBucket,
        stored.video_key,
      );
    }
  });

  let counter = 0;
  // The worker does not run here: a ready video is seeded with a real object.
  const seedVideo = async (
    body: Buffer,
    status: VideoStatus,
  ): Promise<Video> => {
    const publicId = `download${String(++counter).padStart(3, '0')}`;
    const seeded = await dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      title: TITLE,
      status,
      video_key: `${channel.id}/${publicId}/source.mp4`,
    });
    await storage.putObject(
      storage.videosBucket,
      seeded.video_key,
      body,
      'video/mp4',
    );
    return seeded;
  };

  const download = (publicId: string) =>
    request(app.getHttpServer()).get(`/videos/${publicId}/download`);

  it('should download the intact file without authentication', async () => {
    const res = await new Promise<{
      status: number;
      headers: Record<string, string>;
      digest: StreamDigest;
    }>((resolve, reject) => {
      download(video.public_id)
        .buffer(true)
        .parse((response, callback) => {
          digestStream(response as unknown as Readable)
            .then((digest) => callback(null, digest))
            .catch((error: Error) => callback(error, null));
        })
        .end((error, response) => {
          if (error) return reject(error as Error);
          resolve({
            status: response.status,
            headers: response.headers as Record<string, string>,
            digest: response.body as StreamDigest,
          });
        });
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(SIZE));
    expect(res.digest.bytes).toBe(SIZE);
    expect(res.digest.sha256).toBe(sha256(content));
  });

  it('should send it as an attachment with a safe, encoded file name', async () => {
    const res = await download(video.public_id).expect(200);

    const disposition = res.headers['content-disposition'];
    expect(disposition).toMatch(/^attachment; filename="[^"]+\.mp4"/);
    const plain = /filename="([^"]+)"/.exec(disposition)?.[1] ?? '';
    expect(plain).not.toMatch(/[/:]/);
    expect(plain).toMatch(/^[\x20-\x7e]+$/);
    expect(disposition).toContain("filename*=UTF-8''");
    const encoded = /filename\*=UTF-8''(.+)$/.exec(disposition)?.[1] ?? '';
    expect(decodeURIComponent(encoded)).toBe('Meu vídeo teste 1.mp4');
  });

  it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.ERROR])(
    'should answer VIDEO_NOT_READY for a video in %s',
    async (status) => {
      const other = await seedVideo(Buffer.from('x'), status);

      const res = await download(other.public_id).expect(409);

      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
    },
  );

  it('should answer VIDEO_NOT_FOUND for an unknown public_id', async () => {
    const res = await download('aaaaaaaaaaa').expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });
});
