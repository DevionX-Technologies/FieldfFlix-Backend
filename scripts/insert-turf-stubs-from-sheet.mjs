/**
 * Insert sheet-aligned stub `turfs` rows (court placeholders). Cameras unchanged.
 *
 * Defaults is_active=false so `/turfs` filters (active only) behave as before.
 * Set per-row `"is_active": true` only when you intend them to appear in the app.
 *
 *   node scripts/insert-turf-stubs-from-sheet.mjs           # dry-run
 *   node scripts/insert-turf-stubs-from-sheet.mjs --apply
 *   TURF_STUB_JSON=./path.json node scripts/insert-turf-stubs-from-sheet.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');
const NAME_MAX = 100;
const defaultJson = path.join(__dirname, 'data', 'turf-stub-inserts.json');
const jsonPath =
  process.env.TURF_STUB_JSON && process.env.TURF_STUB_JSON.trim() !== ''
    ? path.resolve(process.env.TURF_STUB_JSON)
    : defaultJson;

const raw = fs.readFileSync(jsonPath, 'utf8');
const { inserts } = JSON.parse(raw);
if (!Array.isArray(inserts) || inserts.length === 0) {
  console.error('No inserts[] in', jsonPath);
  process.exit(1);
}

const sportToEnum = {
  Pickleball: 'Pickleball',
  Paddle: 'Paddle',
  Cricket: 'Cricket',
};

function shortenName(s) {
  const n = String(s).trim();
  if (n.length <= NAME_MAX) return n;
  return n.slice(0, NAME_MAX - 13) + '… (trunc)'.slice(0, 13);
}

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const todo = [];

for (const row of inserts) {
  const ex = await client.query('SELECT 1 FROM turfs WHERE id = $1', [row.id]);
  if (ex.rows.length > 0) {
    todo.push({ row, skip: true, reason: 'already exists' });
  } else {
    const sport = sportToEnum[row.sport];
    if (!sport) {
      console.error('Unknown sport for id', row.id, row.sport);
      process.exitCode = 1;
      continue;
    }
    todo.push({
      row: {
        ...row,
        name: shortenName(row.name),
        sportEnum: sport,
        is_active: row.is_active === true,
      },
      skip: false,
    });
  }
}

const toInsert = todo.filter((t) => !t.skip);
const skipped = todo.filter((t) => t.skip);

console.log(
  JSON.stringify(
    {
      jsonPath,
      mode: APPLY ? 'APPLY' : 'DRY_RUN',
      totalInFile: inserts.length,
      willInsert: toInsert.length,
      skipped,
    },
    null,
    2,
  ),
);

if (APPLY && toInsert.length > 0) {
  await client.query('BEGIN');
  try {
    for (const t of toInsert) {
      const r = t.row;
      await client.query(
        `INSERT INTO turfs (
          id, name, location, city, state, country,
          sports_supported, surface_type, is_active,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          CASE $7
            WHEN 'Pickleball' THEN ARRAY['Pickleball']::"ESportsSupported"[]
            WHEN 'Paddle' THEN ARRAY['Paddle']::"ESportsSupported"[]
            WHEN 'Cricket' THEN ARRAY['Cricket']::"ESportsSupported"[]
            ELSE ARRAY['Football']::"ESportsSupported"[]
          END,
          ARRAY['artificial_Grass']::"ESurfaceType"[],
          $8,
          now(), now()
        )`,
        [r.id, r.name, r.location, r.city, r.state, r.country, r.sportEnum, r.is_active],
      );
    }
    await client.query('COMMIT');
    console.log(`COMMITTED ${toInsert.length} stub row(s).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ROLLBACK:', e.message);
    process.exit(1);
  }
} else if (APPLY) {
  console.log('Nothing to insert.');
} else if (toInsert.length > 0) {
  console.log('\nDry-run only. Run with --apply after review.');
}

await client.end();
