import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1748871559513 implements MigrationInterface {
  name = 'Migrations1748871559513';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP CONSTRAINT "FK_3ef9348fad6b4076124ca695ed2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP CONSTRAINT "FK_f0c0161b0a4719065a0ed1aa79d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP CONSTRAINT "FK_2b984d7df2f0316aabe81967620"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP COLUMN "recordingId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP COLUMN "sharedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP COLUMN "sharedWithUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD CONSTRAINT "FK_22a18b9efdd3ac4b227ea4455b9" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD CONSTRAINT "FK_6695352d5f60f8e08df0204e871" FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD CONSTRAINT "FK_b1ba9e39e5141fd446cc9f70d5e" FOREIGN KEY ("shared_with_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP CONSTRAINT "FK_b1ba9e39e5141fd446cc9f70d5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP CONSTRAINT "FK_6695352d5f60f8e08df0204e871"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP CONSTRAINT "FK_22a18b9efdd3ac4b227ea4455b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD "sharedWithUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD "sharedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD "recordingId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD CONSTRAINT "FK_2b984d7df2f0316aabe81967620" FOREIGN KEY ("sharedWithUserId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD CONSTRAINT "FK_f0c0161b0a4719065a0ed1aa79d" FOREIGN KEY ("sharedByUserId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD CONSTRAINT "FK_3ef9348fad6b4076124ca695ed2" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
