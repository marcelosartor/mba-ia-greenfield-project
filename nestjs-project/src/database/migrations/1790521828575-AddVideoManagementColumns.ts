import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideoManagementColumns1790521828575 implements MigrationInterface {
  name = 'AddVideoManagementColumns1790521828575';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "description" character varying(5000)`,
    );
    await queryRunner.query(`ALTER TABLE "videos" ADD "category_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "visibility" character varying(16) NOT NULL DEFAULT 'public'`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "published_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "custom_thumbnail_key" character varying(1024)`,
    );
    // Hand-written data step (Phase 04, TD-01): videos that were already
    // ready were readable by link, so they become published and unlisted;
    // every other video stays an editorial draft (published_at null).
    await queryRunner.query(
      `UPDATE "videos" SET "visibility" = 'unlisted', "published_at" = now() WHERE "status" = 'ready'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_listable" ON "videos" ("channel_id", "published_at", "id") WHERE "published_at" IS NOT NULL AND "visibility" = 'public'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_created" ON "videos" ("channel_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "CHK_videos_published_ready" CHECK ("published_at" IS NULL OR "status" = 'ready')`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "CHK_videos_visibility" CHECK ("visibility" IN ('public', 'unlisted'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_f9fe0463a9fa4899f41ab736511" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_f9fe0463a9fa4899f41ab736511"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "CHK_videos_visibility"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "CHK_videos_published_ready"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_created"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_channel_listable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" DROP COLUMN "custom_thumbnail_key"`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "published_at"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "visibility"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "category_id"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "description"`);
  }
}
