import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source';

/**
 * One-time fresh-database bootstrap.
 *
 * The committed migration set cannot build an empty database from scratch (some
 * migrations assume enum types / tables that no earlier migration creates — they
 * were originally generated against a `synchronize`d schema). For a brand-new DB
 * with no data, this script:
 *
 *   1. builds the full schema directly from the entities (`synchronize: true`),
 *      which also creates required extensions (uuid-ossp, postgis) and enum types;
 *   2. seeds the TypeORM `migrations` table with every existing migration, marking
 *      them as already applied — so normal `migration:run` on subsequent deploys is
 *      a clean no-op and only genuinely NEW migrations run going forward.
 *
 * Run once against the fresh RDS (as a one-off ECS task overriding the command):
 *   node dist/db/bootstrap-sync.js
 *
 * Idempotent: safe to re-run. Long-term, replace the migration set with a clean
 * generated baseline and delete this script.
 */
async function main(): Promise<void> {
  const ds = new DataSource({ ...dataSourceOptions, synchronize: true });
  await ds.initialize();
  console.log('[bootstrap] schema synchronized from entities');

  const qr = ds.createQueryRunner();
  try {
    const hasTable = await qr.hasTable('migrations');
    if (!hasTable) {
      await qr.query(
        `CREATE TABLE "migrations" ("id" SERIAL NOT NULL, "timestamp" bigint NOT NULL, "name" character varying NOT NULL, CONSTRAINT "PK_migrations" PRIMARY KEY ("id"))`,
      );
      console.log('[bootstrap] created migrations table');
    }

    let seeded = 0;
    for (const migration of ds.migrations) {
      const name: string =
        (migration as { name?: string }).name ?? migration.constructor.name;
      const timestamp = Number(name.match(/(\d+)$/)?.[1] ?? '0');
      const exists: unknown[] = await qr.query(
        `SELECT 1 FROM "migrations" WHERE "name" = $1`,
        [name],
      );
      if (exists.length === 0) {
        await qr.query(
          `INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)`,
          [timestamp, name],
        );
        seeded += 1;
      }
    }
    console.log(
      `[bootstrap] migrations table seeded (${seeded} new, ${ds.migrations.length} total)`,
    );
  } finally {
    await qr.release();
    await ds.destroy();
  }
  console.log('[bootstrap] done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[bootstrap] failed:', err);
  process.exit(1);
});
