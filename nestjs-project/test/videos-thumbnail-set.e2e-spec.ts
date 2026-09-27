import type { S3Client } from '@aws-sdk/client-s3';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { generateImage } from '../src/test/image-fixtures';
import { readJpegSize } from '../src/test/media-fixtures';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../src/test/storage-test-client';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';

jest.setTimeout(60000);

const binary = (req: request.Test) =>
  req.buffer(true).parse((res, callback) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });

describe('videos-thumbnail-set', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let cleanupClient: S3Client;
  let tokenA: string;
  let tokenB: string;
  let channel: Channel;
  let video: Video;
  let generated: Buffer;
  let png: Buffer;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    cleanupClient = createStorageTestClient();
    generated = generateImage('jpeg', '640x360', 'black');
    png = generateImage('png', '800x600', 'red');
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
    video = await seedVideo('thumbset001', VideoStatus.READY);
  });

  afterEach(async () => {
    for (const stored of await dataSource.getRepository(Video).find()) {
      for (const name of ['default.jpg', 'custom.jpg']) {
        await deleteStoredObject(
          cleanupClient,
          storage.thumbnailsBucket,
          `${stored.id}/${name}`,
        );
      }
    }
  });

  /** As the worker would: the generated cover is stored when ready. */
  const storeGenerated = async (videoId: string) => {
    const key = `${videoId}/default.jpg`;
    await storage.putObject(
      storage.thumbnailsBucket,
      key,
      generated,
      'image/jpeg',
    );
    return key;
  };

  const seedVideo = async (publicId: string, status: VideoStatus) => {
    const seeded = await dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      title: 'Cover',
      status,
      published_at: status === VideoStatus.READY ? new Date() : null,
      video_key: `${channel.id}/${publicId}/source.mp4`,
    });
    if (status === VideoStatus.READY) {
      await dataSource
        .getRepository(Video)
        .update(
          { id: seeded.id },
          { thumbnail_key: await storeGenerated(seeded.id) },
        );
    }
    return seeded;
  };

  const put = (publicId: string, token: string | null = tokenA) => {
    const req = request(app.getHttpServer()).put(
      `/videos/${publicId}/thumbnail`,
    );
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const customKeyOf = async (id: string) =>
    (await dataSource.getRepository(Video).findOneByOrFail({ id }))
      .custom_thumbnail_key;

  const customObjectExists = async (id: string) => {
    try {
      await storage.headObject(storage.thumbnailsBucket, `${id}/custom.jpg`);
      return true;
    } catch {
      return false;
    }
  };

  // 1. Enviar uma capa customizada

  it('png-valido-vira-capa', async () => {
    await put(video.public_id)
      .attach('file', png, { filename: 'capa.png', contentType: 'image/png' })
      .expect(204);

    expect(await customKeyOf(video.id)).toBe(`${video.id}/custom.jpg`);
    const res = await binary(
      request(app.getHttpServer())
        .get(`/videos/${video.public_id}/thumbnail`)
        .set('Authorization', `Bearer ${tokenA}`),
    ).expect(200);
    const body = res.body as Buffer;
    expect(readJpegSize(body).width).toBe(640);
    expect(Buffer.compare(body, generated)).not.toBe(0);
  });

  it('texto-disfarcado-de-png', async () => {
    const res = await put(video.public_id)
      .attach('file', Buffer.alloc(1024, 'a'), {
        filename: 'capa.png',
        contentType: 'image/png',
      })
      .expect(415);

    expect((res.body as { error: string }).error).toBe('INVALID_IMAGE');
    expect(await customKeyOf(video.id)).toBeNull();
    expect(await customObjectExists(video.id)).toBe(false);
  });

  it('imagem-acima-de-2-mib', async () => {
    const res = await put(video.public_id)
      .attach('file', Buffer.alloc(2_097_153), {
        filename: 'grande.png',
        contentType: 'image/png',
      })
      .expect(413);

    expect((res.body as { error: string }).error).toBe('IMAGE_TOO_LARGE');
    expect(await customKeyOf(video.id)).toBeNull();
  });

  it('sem-campo-file', async () => {
    const res = await put(video.public_id).field('other', 'x').expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION_ERROR');
  });

  it('autorizacao', async () => {
    const other = await put(video.public_id, tokenB)
      .attach('file', png, { filename: 'capa.png', contentType: 'image/png' })
      .expect(403);
    expect((other.body as { error: string }).error).toBe('VIDEO_ACCESS_DENIED');
    expect(await customKeyOf(video.id)).toBeNull();

    await put(video.public_id, null)
      .attach('file', png, { filename: 'capa.png', contentType: 'image/png' })
      .expect(401);
  });

  it('capa-customizada-sobrevive-ao-processamento', async () => {
    const processing = await seedVideo('thumbset002', VideoStatus.PROCESSING);

    await put(processing.public_id)
      .attach('file', png, { filename: 'capa.png', contentType: 'image/png' })
      .expect(204);

    // As the worker does when it finishes: ready + generated cover.
    await dataSource.getRepository(Video).update(
      { id: processing.id },
      {
        status: VideoStatus.READY,
        thumbnail_key: await storeGenerated(processing.id),
      },
    );
    expect(await customKeyOf(processing.id)).toBe(
      `${processing.id}/custom.jpg`,
    );

    const res = await binary(
      request(app.getHttpServer())
        .get(`/videos/${processing.public_id}/thumbnail`)
        .set('Authorization', `Bearer ${tokenA}`),
    ).expect(200);
    const stored = await storage.getObjectRange(
      storage.thumbnailsBucket,
      `${processing.id}/custom.jpg`,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stored.body) chunks.push(chunk as Buffer);
    expect(Buffer.compare(res.body as Buffer, Buffer.concat(chunks))).toBe(0);
    expect(Buffer.compare(res.body as Buffer, generated)).not.toBe(0);
  });
});
