/**
 * Applies the same turf `sports_supported` rules as scripts/update-turf-sports-supported.sql.
 *
 * Note: Balkanji Bari is Pickleball-only in FieldFlix *operational mapping* (`deriveFlickSportFromTurf`
 * + turfs list filtering). Legacy DB rows may still list Cricket historic values — **do not** bulk-fix
 * them here unless ops explicitly intends to rewrite `turfs`; there is intentionally no Balkanji UPDATE step.
 *
 * Usage:
 *   node scripts/apply-turf-sports-supported.mjs          # dry-run (default)
 *   node scripts/apply-turf-sports-supported.mjs --apply  # run in one transaction + COMMIT
 *
 * Loads DB from ../.env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE).
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Client } = pg;

const APPLY = process.argv.includes('--apply');

/** @typedef {{ label: string, sql: string, params?: unknown[] }} UpdateStep */

/** @type {UpdateStep[]} */
const STEPS = [
  {
    label: 'TSG Padel Arena',
    sql: `UPDATE turfs SET sports_supported = ARRAY['Paddle']::"ESportsSupported"[] WHERE name ILIKE '%TSG Padel Arena%'`,
  },
  {
    label: 'Pickleflow',
    sql: `UPDATE turfs SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[] WHERE name ILIKE '%Pickleflow%'`,
  },
  {
    label: 'Botanical Gardens',
    sql: `UPDATE turfs SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[] WHERE name ILIKE '%Botanical Gardens%'`,
  },
  {
    label: 'Eskay Resort',
    sql: `UPDATE turfs SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[] WHERE name ILIKE '%Eskay Resort%'`,
  },
  {
    label: 'PickPad (Padel venue)',
    sql: `UPDATE turfs SET sports_supported = ARRAY['Paddle']::"ESportsSupported"[] WHERE name ILIKE '%PickPad%'`,
  },
  {
    label: 'Global Sports x Balkanji',
    sql: `UPDATE turfs SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[] WHERE name ILIKE '%Balkanji Bari%' AND name ILIKE '%Global Sports%'`,
  },
  {
    label: 'Santacruz West turf names',
    sql: `UPDATE turfs SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[] WHERE name ILIKE '%Santacruz West%'`,
  },
];

const client = new Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const report = [];

for (const step of STEPS) {
  const whereMatch = /^UPDATE turfs SET sports_supported[^W]+WHERE (.+)$/i.exec(
    step.sql.trim(),
  );
  const predicate = whereMatch ? whereMatch[1] : 'FALSE';
  const countRes = await client.query(
    `SELECT COUNT(*)::int AS n FROM turfs WHERE ${predicate}`,
  );
  report.push({
    step: step.label,
    matchingRows: countRes.rows[0]?.n ?? 0,
  });
}

if (!APPLY) {
  console.log(
    JSON.stringify(
      {
        mode: 'dry-run',
        hint: 'Re-run with --apply to execute in one transaction.',
        previews: report,
      },
      null,
      2,
    ),
  );
  await client.end();
  process.exit(0);
}

await client.query('BEGIN');
try {
  for (const step of STEPS) {
    const r = await client.query(step.sql);
    console.log(step.label, 'rowCount=', r.rowCount);
  }
  await client.query('COMMIT');
  console.log('COMMIT OK');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('ROLLBACK', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await client.end();
}
