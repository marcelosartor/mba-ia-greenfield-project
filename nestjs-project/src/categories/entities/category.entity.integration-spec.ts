import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { createTestDataSource } from '../../test/create-test-data-source';
import { Category } from './category.entity';

describe('Category entity (integration)', () => {
  let dataSource: DataSource;
  let repository: Repository<Category>;
  const createdSlugs: string[] = [];

  beforeAll(async () => {
    // The table comes from the migrations; no synchronize on shared data.
    dataSource = createTestDataSource([Category], { synchronize: false });
    await dataSource.initialize();
    repository = dataSource.getRepository(Category);
  });

  afterEach(async () => {
    if (createdSlugs.length > 0) {
      await dataSource.query(
        'DELETE FROM "categories" WHERE "slug" = ANY($1::text[])',
        [createdSlugs.splice(0)],
      );
    }
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should reject a slug that already exists (UQ_categories_slug)', async () => {
    await expect(
      repository.insert({ slug: 'musica', name: 'Duplicada' }),
    ).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'UQ_categories_slug' },
    });
  });

  it('should require a name', async () => {
    createdSlugs.push('sem-nome');
    await expect(
      dataSource.query('INSERT INTO "categories" ("slug") VALUES ($1)', [
        'sem-nome',
      ]),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('should generate the uuid primary key', async () => {
    createdSlugs.push('teste-uuid');
    const saved = await repository.save({ slug: 'teste-uuid', name: 'Teste' });

    expect(saved.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
