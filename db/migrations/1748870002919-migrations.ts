import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1748870002919 implements MigrationInterface {
  name = 'Migrations1748870002919';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "shared_recordings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recording_id" uuid NOT NULL, "shared_by_user_id" uuid NOT NULL, "shared_with_user_id" uuid NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "recordingId" uuid, "sharedByUserId" uuid, "sharedWithUserId" uuid, CONSTRAINT "PK_6f76f04230fac915c464eb853dc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD CONSTRAINT "FK_3ef9348fad6b4076124ca695ed2" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD CONSTRAINT "FK_f0c0161b0a4719065a0ed1aa79d" FOREIGN KEY ("sharedByUserId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" ADD CONSTRAINT "FK_2b984d7df2f0316aabe81967620" FOREIGN KEY ("sharedWithUserId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP CONSTRAINT "FK_2b984d7df2f0316aabe81967620"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP CONSTRAINT "FK_f0c0161b0a4719065a0ed1aa79d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shared_recordings" DROP CONSTRAINT "FK_3ef9348fad6b4076124ca695ed2"`,
    );
    await queryRunner.query(`DROP TABLE "shared_recordings"`);
  }
}
