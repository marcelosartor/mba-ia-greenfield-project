import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';
import { discardStoredUploads } from './helpers/video-e2e';

interface Page {
  items: Record<string, unknown>[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  error?: string;
}

describe('channels-me-videos', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let tokenA: string;
  let tokenB: string;
  let created: string[];

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
    tokenA = await registerConfirmAndLogin(app, 'owner-a@example.com');
    tokenB = await registerConfirmAndLogin(app, 'other-b@example.com');
    // Four videos of A created in sequence, then their processing state and
    // publication seeded on the row (the worker does not run here).
    created = [];
    const states: [VideoStatus, boolean][] = [
      [VideoStatus.DRAFT, false],
      [VideoStatus.PROCESSING, false],
      [VideoStatus.READY, true],
      [VideoStatus.ERROR, false],
    ];
    for (const [i, [status, published]] of states.entries()) {
      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          filename: `v${i}.mp4`,
          content_type: 'video/mp4',
          size_bytes: 1000,
        })
        .expect(201);
      const publicId = (res.body as { public_id: string }).public_id;
      created.push(publicId);
      await dataSource.getRepository(Video).update(
        { public_id: publicId },
        {
          status,
          published_at: published ? new Date() : null,
          // Distinct instants, in creation order.
          created_at: new Date(Date.UTC(2026, 8, 1, 10, i)),
        },
      );
    }
  });

  afterEach(async () => {
    await discardStoredUploads(
      storage,
      await dataSource.getRepository(Video).find(),
    );
  });

  const panel = (query = '', token: string | null = tokenA) => {
    const req = request(app.getHttpServer()).get(`/channels/me/videos${query}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  // 1. Listar o painel do próprio canal

  it('dono-ve-todos-os-status', async () => {
    const res = await panel().expect(200);

    const body = res.body as Page;
    expect(body.total).toBe(4);
    expect(body.items).toHaveLength(4);
    expect(new Set(body.items.map((item) => item.status))).toEqual(
      new Set(['draft', 'processing', 'ready', 'error']),
    );
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'category',
          'comments',
          'created_at',
          'likes',
          'public_id',
          'published_at',
          'status',
          'thumbnail_url',
          'title',
          'views',
          'visibility',
        ].sort(),
      );
      expect(item).toMatchObject({ views: 0, likes: 0, comments: 0 });
    }
  });

  it('outro-usuario-nao-ve-os-videos', async () => {
    const res = await panel('', tokenB).expect(200);

    expect((res.body as Page).items).toEqual([]);
    expect((res.body as Page).total).toBe(0);
  });

  it('paginacao-na-ordem-de-criacao', async () => {
    const res = await panel('?page=2&limit=1').expect(200);

    const body = res.body as Page;
    expect(body).toMatchObject({ page: 2, limit: 1, total: 4, total_pages: 4 });
    expect(body.items).toHaveLength(1);
    expect(body.items[0].public_id).toBe(created[2]);
  });

  it('paginacao-invalida', async () => {
    for (const query of ['?limit=51', '?page=0']) {
      const res = await panel(query).expect(400);
      expect((res.body as Page).error).toBe('VALIDATION_ERROR');
    }
  });

  it('anonimo', async () => {
    await panel('', null).expect(401);
  });

  it('canal-com-nickname-me-nao-confunde-a-rota', async () => {
    const userB = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: 'other-b@example.com' });
    await dataSource
      .getRepository(Channel)
      .update({ user_id: userB.id }, { nickname: 'me' });

    const res = await panel().expect(200);

    expect((res.body as Page).total).toBe(4);
    expect(
      (res.body as Page).items.map((item) => item.public_id).sort(),
    ).toEqual([...created].sort());
  });
});
