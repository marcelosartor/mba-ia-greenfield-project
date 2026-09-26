import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeclaredSizeToVideos1790433669266 implements MigrationInterface {
  name = 'AddDeclaredSizeToVideos1790433669266';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "declared_size_bytes" bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP COLUMN "declared_size_bytes"`,
    );
  }
}
