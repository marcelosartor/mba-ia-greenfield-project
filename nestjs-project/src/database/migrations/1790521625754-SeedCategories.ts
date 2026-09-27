import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data: the initial list of video categories. Hand-written because
 * the CLI generates schema only (data migrations are the exception allowed by
 * the migration rules). `down` removes only these rows.
 */
export const INITIAL_CATEGORIES: ReadonlyArray<{ slug: string; name: string }> =
  [
    { slug: 'musica', name: 'Música' },
    { slug: 'jogos', name: 'Jogos' },
    { slug: 'educacao', name: 'Educação' },
    { slug: 'entretenimento', name: 'Entretenimento' },
    { slug: 'esportes', name: 'Esportes' },
    { slug: 'noticias', name: 'Notícias' },
    { slug: 'tecnologia', name: 'Tecnologia' },
    { slug: 'filmes-e-animacao', name: 'Filmes e Animação' },
    { slug: 'viagens', name: 'Viagens' },
    { slug: 'culinaria', name: 'Culinária' },
    { slug: 'outros', name: 'Outros' },
  ];

export class SeedCategories1790521625754 implements MigrationInterface {
  name = 'SeedCategories1790521625754';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { slug, name } of INITIAL_CATEGORIES) {
      await queryRunner.query(
        'INSERT INTO "categories" ("slug", "name") VALUES ($1, $2) ON CONFLICT ("slug") DO NOTHING',
        [slug, name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DELETE FROM "categories" WHERE "slug" = ANY($1::text[])',
      [INITIAL_CATEGORIES.map(({ slug }) => slug)],
    );
  }
}
