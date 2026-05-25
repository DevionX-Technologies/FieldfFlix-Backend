import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist physical court numbers per camera for Find My Game dropdowns and library labels.
 * UUIDs correspond to ops spreadsheet (prefix 27ce1af1-721a-421c-9223-…). Non-matching envs skip rows (0-row UPDATE is fine).
 *
 * Known discrepancy — Botanical Gardens (Andheri): operational court numbers are 3–6 (not starting at 1).
 */
export class CameraCourtNumber1762600000000 implements MigrationInterface {
  name = 'CameraCourtNumber1762600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cameras" ADD "court_number" integer`);

    const updates: Array<{ id: string; court: number }> = [
      // TSG Sports Arena | Eskay Resort — Pickleball 1–4
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f329',
        court: 1,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f318',
        court: 2,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f319',
        court: 3,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f31a',
        court: 4,
      },
      // TSG Pickleball Arena | All India Balkanji Bari — Pickleball 1–3
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f31b',
        court: 1,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f31c',
        court: 2,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f31d',
        court: 3,
      },
      // TSG Sports Arena Santacruz — Cricket 1
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f316',
        court: 1,
      },
      // TSG Padel Arena Goregaon East — Padel 1–2
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f31f',
        court: 1,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f320',
        court: 2,
      },
      // PickPad by Aim Sports Goregaon West — Padel 1
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f321',
        court: 1,
      },
      // Pickleflow Social Noida — Pickleball 1–3
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f322',
        court: 1,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f323',
        court: 2,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f324',
        court: 3,
      },
      // TSG Botanical Gardens — Pickleball courts 3–6 (physical numbering)
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f325',
        court: 3,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f326',
        court: 4,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f327',
        court: 5,
      },
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f328',
        court: 6,
      },
    ];

    for (const row of updates) {
      await queryRunner.query(
        `UPDATE "cameras" SET "court_number" = $1 WHERE "id" = $2`,
        [row.court, row.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP COLUMN IF EXISTS "court_number"`,
    );
  }
}
