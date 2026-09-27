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

describe('videos-thumbnail-delete', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let cleanupClient: S3Client;
  let tokenA: string;
  let tokenB: string;
  let video: Video;
  let generated: Buffer;
  let custom: Buffer;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    cleanupClient = createStorageTestClient();
    generated = generateImage('jpeg', '640x360', 'black');
    custom = generateImage('jpeg', '640x360', 'yellow');
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
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: owner.id });
    video = await dataSource.getRepository(Video).save({
      public_id: 'thumbdel001',
      channel_id: channel.id,
      title: 'Cover',
      status: VideoStatus.READY,
      published_at: new Date(),
      video_key: `${channel.id}/thumbdel001/source.mp4`,
    });
    const defaultKey = `${video.id}/default.jpg`;
    const customKey = `${video.id}/custom.jpg`;
    await storage.putObject(
      storage.thumbnailsBucket,
      defaultKey,
      generated,
      'image/jpeg',
    );
    await storage.putObject(
      storage.thumbnailsBucket,
      customKey,
      custom,
      'image/jpeg',
    );
    await dataSource
      .getRepository(Video)
      .update(
        { id: video.id },
        { thumbnail_key: defaultKey, custom_thumbnail_key: customKey },
      );
  });

  afterEach(async () => {
    for (const name of ['default.jpg', 'custom.jpg']) {
      await deleteStoredObject(
        cleanupClient,
        storage.thumbnailsBucket,
        `${video.id}/${name}`,
      );
    }
  });

  const remove = (token: string | null = tokenA) => {
    const req = request(app.getHttpServer()).delete(
      `/videos/${video.public_id}/thumbnail`,
    );
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const exists = async (name: string) => {
    try {
      await storage.headObject(storage.thumbnailsBucket, `${video.id}/${name}`);
      return true;
    } catch {
      return false;
    }
  };

  // 1. Remover a capa customizada

  it('remove-e-volta-para-a-capa-gerada', async () => {
    await remove().expect(204);

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(row.custom_thumbnail_key).toBeNull();
    expect(await exists('custom.jpg')).toBe(false);

    const res = await binary(
      request(app.getHttpServer()).get(`/videos/${video.public_id}/thumbnail`),
    ).expect(200);
    expect(Buffer.compare(res.body as Buffer, generated)).toBe(0);
  });

  it('sem-capa-customizada-e-idempotente', async () => {
    await remove().expect(204);
    await remove().expect(204);

    expect(await exists('default.jpg')).toBe(true);
  });

  it('autorizacao', async () => {
    const other = await remove(tokenB).expect(403);
    expect((other.body as { error: string }).error).toBe('VIDEO_ACCESS_DENIED');
    expect(await exists('custom.jpg')).toBe(true);

    await remove(null).expect(401);
  });
});
