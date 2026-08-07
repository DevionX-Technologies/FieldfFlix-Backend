import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTournamentsTable1762900000000 implements MigrationInterface {
  name = 'CreateTournamentsTable1762900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournaments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(255) NOT NULL,
        "sport" character varying(100) NOT NULL DEFAULT 'Pickleball',
        "bannerImage" character varying(500),
        "prizePool" integer NOT NULL DEFAULT 0,
        "closingDate" TIMESTAMP,
        "venue" character varying(255) NOT NULL DEFAULT 'Venue Stadium',
        "city" character varying(100) NOT NULL DEFAULT 'Mumbai',
        "startDate" TIMESTAMP NOT NULL DEFAULT now(),
        "endDate" TIMESTAMP,
        "participantsCount" integer NOT NULL DEFAULT 0,
        "maxParticipants" integer NOT NULL DEFAULT 32,
        "entryFee" integer NOT NULL DEFAULT 0,
        "skillLevel" character varying(50) NOT NULL DEFAULT 'Open / Intermediate',
        "ageGroup" character varying(50) NOT NULL DEFAULT 'All Ages',
        "gender" character varying(50) NOT NULL DEFAULT 'Open',
        "isIndoor" boolean NOT NULL DEFAULT true,
        "status" character varying(50) NOT NULL DEFAULT 'Upcoming',
        "description" text,
        "organizer" jsonb,
        "prizes" jsonb,
        "fixtures" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tournaments_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tournaments_sport" ON "tournaments" ("sport")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tournaments_status" ON "tournaments" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tournaments_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tournaments_sport"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tournaments"`);
  }
}
