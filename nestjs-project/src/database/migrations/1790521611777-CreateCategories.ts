import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCategories1790521611777 implements MigrationInterface {
  name = 'CreateCategories1790521611777';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying(50) NOT NULL, "name" character varying(50) NOT NULL, CONSTRAINT "UQ_categories_slug" UNIQUE ("slug"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "categories"`);
  }
}
