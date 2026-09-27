import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Category } from '../categories/entities/category.entity';
import { Channel } from '../channels/entities/channel.entity';
import { ALL_MIGRATIONS, undoMigrationsThrough } from '../test/all-migrations';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { AddVideoManagementColumns1790521828575 } from './migrations/1790521828575-AddVideoManagementColumns';

describe('Video management migration (integration)', () => {
  let dataSource: DataSource;

  const columnsOfVideos = async (): Promise<string[]> =>
    (
      await dataSource.query<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'videos'`,
      )
    ).map((row) => row.column_name);

  const insertVideo = async (
    channelId: string,
    status: string,
  ): Promise<string> => {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO "videos" ("id", "public_id", "channel_id", "title", "status", "video_key")
       VALUES ($1, $2, $3, 'Legacy', $4, 'k')`,
      [id, id.replace(/-/g, '').slice(0, 11), channelId, status],
    );
    return id;
  };

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken, Video, Category],
      {
        synchronize: false,
        migrations: ALL_MIGRATIONS,
      },
    );
    await dataSource.initialize();
    await dataSource.runMigrations();
    await cleanAllTables(dataSource);
  });

  afterAll(async () => {
    try {
      await cleanAllTables(dataSource);
      await dataSource.runMigrations();
    } finally {
      await dataSource.destroy();
    }
  });

  it('should publish the ready videos that existed before as unlisted and leave the others as drafts', async () => {
    await undoMigrationsThrough(
      dataSource,
      AddVideoManagementColumns1790521828575,
    );
    expect(await columnsOfVideos()).not.toContain('published_at');

    const [user] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO "users" ("email", "password") VALUES ('legacy@example.com', 'x') RETURNING "id"`,
    );
    const [channel] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO "channels" ("name", "nickname", "user_id") VALUES ('Legacy', 'legacy', $1) RETURNING "id"`,
      [user.id],
    );
    const readyId = await insertVideo(channel.id, 'ready');
    const processingId = await insertVideo(channel.id, 'processing');

    await dataSource.runMigrations();

    const rows = await dataSource.query<
      { id: string; visibility: string; published_at: Date | null }[]
    >(`SELECT "id", "visibility", "published_at" FROM "videos"`);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(readyId)).toMatchObject({ visibility: 'unlisted' });
    expect(byId.get(readyId)?.published_at).toBeInstanceOf(Date);
    expect(byId.get(processingId)).toMatchObject({
      visibility: 'public',
      published_at: null,
    });
  });

  it('should revert by removing the new columns', async () => {
    await cleanAllTables(dataSource);
    await undoMigrationsThrough(
      dataSource,
      AddVideoManagementColumns1790521828575,
    );

    const columns = await columnsOfVideos();
    for (const column of [
      'description',
      'category_id',
      'visibility',
      'published_at',
      'custom_thumbnail_key',
    ]) {
      expect(columns).not.toContain(column);
    }
    expect(columns).toContain('declared_size_bytes');

    await dataSource.runMigrations();
  });
});
