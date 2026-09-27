import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Video } from '../videos/entities/video.entity';
import { Category } from '../categories/entities/category.entity';
import { AddDeclaredSizeToVideos1790433669266 } from './migrations/1790433669266-AddDeclaredSizeToVideos';
import { CreateVideos1789938672313 } from './migrations/1789938672313-CreateVideos';
import { ALL_MIGRATIONS, undoMigrationsThrough } from '../test/all-migrations';
import { createTestDataSource } from '../test/create-test-data-source';

const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
  'categories',
];

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken, Video, Category],
      { synchronize: false, migrations: ALL_MIGRATIONS },
    );

    await dataSource.initialize();

    // Sequential on purpose: concurrent DROP ... CASCADE on tables linked by
    // foreign keys deadlocks on each other's locks.
    for (const table of [...MANAGED_TABLES, 'migrations']) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    // Postgres enum types outlive their tables; drop them so the migrations
    // can be re-applied on a database that was already migrated.
    await dataSource.query(
      `DROP TYPE IF EXISTS "public"."verification_tokens_type_enum"`,
    );
  });

  afterAll(async () => {
    // The last tests undo migrations, leaving the videos table missing.
    // Re-apply so the shared DB is fully migrated when subsequent suites run.
    try {
      await dataSource.runMigrations();
    } finally {
      await dataSource.destroy();
    }
  });

  it('should apply all migrations and create all the tables', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(ALL_MIGRATIONS.length);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'categories',
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'videos',
    ]);
  });

  const columnsOfVideos = async (): Promise<string[]> =>
    (
      await dataSource.query<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'videos'`,
      )
    ).map((row) => row.column_name);

  it('should add the declared size column and revert it without touching the table', async () => {
    expect(await columnsOfVideos()).toContain('declared_size_bytes');

    await undoMigrationsThrough(
      dataSource,
      AddDeclaredSizeToVideos1790433669266,
    );

    const columns = await columnsOfVideos();
    expect(columns).not.toContain('declared_size_bytes');
    expect(columns).toContain('upload_completed_at');
  });

  it('should revert the videos migration and remove the table', async () => {
    await undoMigrationsThrough(dataSource, CreateVideos1789938672313);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['videos']],
    );
    expect(result).toHaveLength(0);
  });
});
