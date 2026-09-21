import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1789938672313 implements MigrationInterface {
  name = 'CreateVideos1789938672313';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "public_id" character varying(11) NOT NULL, "channel_id" uuid NOT NULL, "title" character varying(100) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'draft', "video_key" character varying(1024) NOT NULL, "thumbnail_key" character varying(1024), "upload_id" character varying(1024), "upload_completed_at" TIMESTAMP, "duration_seconds" numeric(12,3), "width" integer, "height" integer, "video_codec" character varying(64), "audio_codec" character varying(64), "bit_rate" bigint, "format_name" character varying(128), "size_bytes" bigint, "metadata" jsonb, "error_code" character varying(64), "error_message" character varying(500), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_videos_public_id" UNIQUE ("public_id"), CONSTRAINT "CHK_videos_status" CHECK ("status" IN ('draft', 'processing', 'ready', 'error')), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status_created_at" ON "videos" ("status", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_status_created_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_id"`);
    await queryRunner.query(`DROP TABLE "videos"`);
  }
}
