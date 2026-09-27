import { S3Client } from '@aws-sdk/client-s3';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Readable } from 'node:stream';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { waitFor } from '../src/test/wait-for';
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
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';

jest.setTimeout(180000);

const MIB = 1024 * 1024;
const SMALL_SIZE = 3 * MIB;

describe('videos-stream', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let cleanupClient: S3Client;
  let channel: Channel;
  let small: { video: Video; content: Buffer };
  let tokenA: string;
  let tokenB: string;

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
    tokenA = await registerConfirmAndLogin(app, 'owner-a@example.com');
    tokenB = await registerConfirmAndLogin(app, 'other-b@example.com');
    const owner = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: 'owner-a@example.com' });
    channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: owner.id });
    small = await seedVideo(SMALL_SIZE);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const video of await dataSource.getRepository(Video).find()) {
      await deleteStoredObject(
        cleanupClient,
        storage.videosBucket,
        video.video_key,
      );
    }
  });

  let counter = 0;
  // The worker and the publication do not run here: a video is seeded with a
  // real object, published unless `published` is false (only a ready video
  // can be published).
  const seedVideo = async (
    sizeBytes: number,
    status: VideoStatus = VideoStatus.READY,
    published = status === VideoStatus.READY,
  ): Promise<{ video: Video; content: Buffer }> => {
    const publicId = `stream${String(++counter).padStart(5, '0')}`;
    const content = randomContent(sizeBytes);
    const video = await dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      title: 'Streamed',
      status,
      published_at: published ? new Date() : null,
      video_key: `${channel.id}/${publicId}/source.mp4`,
    });
    await storage.putObject(
      storage.videosBucket,
      video.video_key,
      content,
      'video/mp4',
    );
    return { video, content };
  };

  const stream = (publicId: string, range?: string, token?: string) => {
    let req = request(app.getHttpServer()).get(`/videos/${publicId}/stream`);
    if (range) req = req.set('Range', range);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  // Reads the body as a stream, never accumulating it.
  const digestBody = (
    publicId: string,
    range?: string,
    token?: string,
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    digest: StreamDigest;
  }> =>
    new Promise((resolve, reject) => {
      stream(publicId, range, token)
        .maxResponseSize(1024 * MIB) // superagent stops at 200 MB by default
        .buffer(true) // the parser below consumes the body; nothing accumulates
        .parse((res, callback) => {
          digestStream(res as unknown as Readable)
            .then((digest) => callback(null, digest))
            .catch((error: Error) => callback(error, null));
        })
        .end((error, res) => {
          if (error) return reject(error as Error);
          resolve({
            status: res.status,
            headers: res.headers as Record<string, string>,
            digest: res.body as StreamDigest,
          });
        });
    });

  // 1. Transmitir o vídeo conforme a publicação

  it('primeiro-quilobyte-por-range-em-video-publicado', async () => {
    const res = await stream(small.video.public_id, 'bytes=0-1023')
      .buffer(true)
      .parse((r, callback) => {
        const chunks: Buffer[] = [];
        r.on('data', (chunk: Buffer) => chunks.push(chunk));
        r.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(206);

    expect(res.headers['content-range']).toBe(`bytes 0-1023/${SMALL_SIZE}`);
    expect(res.headers['content-length']).toBe('1024');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.body).toEqual(small.content.subarray(0, 1024));
  });

  it('rascunho-so-para-o-dono', async () => {
    const draft = await seedVideo(SMALL_SIZE, VideoStatus.READY, false);

    for (const token of [undefined, tokenB]) {
      const res = await stream(draft.video.public_id, undefined, token).expect(
        404,
      );
      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
    }

    const { status, digest } = await digestBody(
      draft.video.public_id,
      undefined,
      tokenA,
    );
    expect(status).toBe(200);
    expect(digest.sha256).toBe(sha256(draft.content));
  });

  it('stream-completo-sem-range', async () => {
    const { status, headers, digest } = await digestBody(small.video.public_id);

    expect(status).toBe(200);
    expect(headers['accept-ranges']).toBe('bytes');
    expect(headers['content-length']).toBe(String(SMALL_SIZE));
    expect(headers['content-type']).toBe('video/mp4');
    expect(headers['cache-control']).toBe('private, no-cache');
    expect(headers.etag).toBeTruthy();
    expect(digest.sha256).toBe(sha256(small.content));
  });

  it('busca-em-qualquer-ponto-do-arquivo', async () => {
    const { status, headers, digest } = await digestBody(
      small.video.public_id,
      `bytes=${SMALL_SIZE - 1000}-`,
    );

    expect(status).toBe(206);
    expect(headers['content-range']).toBe(
      `bytes ${SMALL_SIZE - 1000}-${SMALL_SIZE - 1}/${SMALL_SIZE}`,
    );
    expect(digest.sha256).toBe(
      sha256(small.content.subarray(SMALL_SIZE - 1000)),
    );
  });

  it('ignora-range-com-mais-de-um-intervalo', async () => {
    const { status, headers } = await digestBody(
      small.video.public_id,
      'bytes=0-10,20-30',
    );

    expect(status).toBe(200);
    expect(headers['content-length']).toBe(String(SMALL_SIZE));
  });

  it('range-nao-satisfatorio', async () => {
    const res = await stream(
      small.video.public_id,
      'bytes=9999999-10000000',
    ).expect(416);

    expect((res.body as { error: string }).error).toBe('INVALID_RANGE');
    expect(res.headers['content-range']).toBe(`bytes */${SMALL_SIZE}`);
  });

  it('nao-pronto-e-inexistente', async () => {
    for (const status of [
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      VideoStatus.ERROR,
    ]) {
      const { video } = await seedVideo(1024, status);

      const res = await stream(video.public_id, undefined, tokenA).expect(409);

      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
    }

    const res = await stream('aaaaaaaaaaa').expect(404);
    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('stream-nao-bufferiza-o-arquivo', async () => {
    const size = 200 * MIB;
    const { video, content } = await seedVideo(size);
    const head = await storage.headObject(
      storage.videosBucket,
      video.video_key,
    );
    expect(head.contentLength).toBe(size);
    const expectedHash = sha256(content);
    const heapBefore = process.memoryUsage().heapUsed;

    const { status, digest } = await digestBody(video.public_id);

    expect(status).toBe(200);
    expect(digest.bytes).toBe(size);
    expect(digest.sha256).toBe(expectedHash);
    expect(digest.peakHeapGrowthBytes).toBeLessThan(50 * MIB);
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(50 * MIB);
  });

  it('para-de-ler-o-storage-quando-o-cliente-sai', async () => {
    const { video } = await seedVideo(40 * MIB);
    let storageBody: Readable | undefined;
    const original = storage.getObjectRange.bind(
      storage,
    ) as StorageService['getObjectRange'];
    jest
      .spyOn(storage, 'getObjectRange')
      .mockImplementation(async (...args) => {
        const result = await original(...args);
        storageBody = result.body;
        return result;
      });
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) => server.listen(0, resolve));
    }
    const { port } = server.address() as AddressInfo;

    await new Promise<void>((resolve, reject) => {
      const clientRequest = get(
        { port, path: `/videos/${video.public_id}/stream` },
        (response) => {
          response.once('data', () => {
            clientRequest.destroy(); // the player closes the tab
            resolve();
          });
        },
      );
      clientRequest.on('error', () => undefined);
      clientRequest.on('timeout', () => reject(new Error('no data received')));
    });

    await waitFor(() => Promise.resolve(storageBody?.destroyed || undefined), {
      timeoutMs: 10_000,
    });
    expect(storageBody?.destroyed).toBe(true);
  });
});
