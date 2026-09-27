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

describe('videos-thumbnail-get', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let cleanupClient: S3Client;
  let tokenA: string;
  let channel: Channel;
  let video: Video;
  let cover: Buffer;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    cleanupClient = createStorageTestClient();
    cover = generateImage('jpeg', '640x360');
  });

  afterAll(async () => {
    cleanupClient.destroy();
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
    tokenA = await registerConfirmAndLogin(app, 'owner-a@example.com');
    const owner = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: 'owner-a@example.com' });
    channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: owner.id });
    // As the worker would: a ready video with its generated cover stored.
    video = await dataSource.getRepository(Video).save({
      public_id: 'thumbget001',
      channel_id: channel.id,
      title: 'With cover',
      status: VideoStatus.READY,
      video_key: `${channel.id}/thumbget001/source.mp4`,
    });
    const key = `${video.id}/default.jpg`;
    await storage.putObject(storage.thumbnailsBucket, key, cover, 'image/jpeg');
    await dataSource
      .getRepository(Video)
      .update({ id: video.id }, { thumbnail_key: key });
  });

  afterEach(async () => {
    await deleteStoredObject(
      cleanupClient,
      storage.thumbnailsBucket,
      `${video.id}/default.jpg`,
    );
  });

  const publish = () =>
    dataSource
      .getRepository(Video)
      .update({ id: video.id }, { published_at: new Date() });

  const thumbnail = (publicId: string, token?: string) => {
    const req = request(app.getHttpServer()).get(
      `/videos/${publicId}/thumbnail`,
    );
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  // 1. Obter a capa do vídeo

  it('anonimo-recebe-capa-gerada', async () => {
    await publish();

    const res = await binary(thumbnail(video.public_id)).expect(200);

    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(Buffer.compare(res.body as Buffer, cover)).toBe(0);
  });

  it('rascunho-so-para-o-dono', async () => {
    const anonymous = await thumbnail(video.public_id).expect(404);
    expect((anonymous.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');

    const owner = await binary(thumbnail(video.public_id, tokenA)).expect(200);
    expect(owner.headers['content-type']).toBe('image/jpeg');
  });

  it('video-em-processamento-para-o-dono', async () => {
    const processing = await dataSource.getRepository(Video).save({
      public_id: 'thumbget002',
      channel_id: channel.id,
      title: 'Processing',
      status: VideoStatus.PROCESSING,
      video_key: `${channel.id}/thumbget002/source.mp4`,
    });

    const res = await thumbnail(processing.public_id, tokenA).expect(409);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
  });

  it('rota-publica-nao-recebe-429', async () => {
    await publish();
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await binary(thumbnail(video.public_id))).status);
    }

    expect(new Set(statuses)).toEqual(new Set([200]));
  });
});
