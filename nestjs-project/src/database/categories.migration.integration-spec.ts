import { DataSource } from 'typeorm';
import { Category } from '../categories/entities/category.entity';
import { ALL_MIGRATIONS, undoMigrationsThrough } from '../test/all-migrations';
import { createTestDataSource } from '../test/create-test-data-source';
import { CreateCategories1790521611777 } from './migrations/1790521611777-CreateCategories';
import { INITIAL_CATEGORIES } from './migrations/1790521625754-SeedCategories';

describe('Categories migrations (integration)', () => {
  let dataSource: DataSource;

  const categoriesTableExists = async (): Promise<boolean> => {
    const rows = await dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'categories') AS "exists"`,
    );
    return rows[0].exists;
  };

  const slugs = async (): Promise<string[]> =>
    (
      await dataSource.query<{ slug: string }[]>(
        'SELECT "slug" FROM "categories" ORDER BY "slug"',
      )
    ).map((row) => row.slug);

  beforeAll(async () => {
    dataSource = createTestDataSource([Category], {
      synchronize: false,
      migrations: ALL_MIGRATIONS,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    try {
      await dataSource.runMigrations();
    } finally {
      await dataSource.destroy();
    }
  });

  it('should create the table with exactly the 11 initial categories', async () => {
    expect(await slugs()).toEqual(
      INITIAL_CATEGORIES.map(({ slug }) => slug).sort(),
    );
  });

  it('should revert the data and the table, and recreate them on the next run', async () => {
    await undoMigrationsThrough(dataSource, CreateCategories1790521611777);
    expect(await categoriesTableExists()).toBe(false);

    await dataSource.runMigrations();

    expect(await categoriesTableExists()).toBe(true);
    expect(await slugs()).toHaveLength(11);
  });
});
