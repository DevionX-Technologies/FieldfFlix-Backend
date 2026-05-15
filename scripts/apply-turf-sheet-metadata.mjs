/**
 * Apply ops-sheet display metadata to existing `turfs` rows (by UUID).
 * Never updates `sports_supported` (past plans / sport attribution unchanged).
 * Does not move cameras or insert new turfs (use a follow-up if you split courts).
 *
 * Usage:
 *   node scripts/apply-turf-sheet-metadata.mjs              # dry-run (default)
 *   node scripts/apply-turf-sheet-metadata.mjs --apply      # run in one transaction
 *   TURF_SHEET_JSON=./path.json node scripts/apply-turf-sheet-metadata.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const NAME_MAX = 100;
const APPLY = process.argv.includes('--apply');

const defaultJson = path.join(__dirname, 'data', 'turf-sheet-metadata.json');
const patchPath =
  process.env.TURF_SHEET_JSON && process.env.TURF_SHEET_JSON.trim() !== ''
    ? path.resolve(process.env.TURF_SHEET_JSON)
    : defaultJson;

const raw = fs.readFileSync(patchPath, 'utf8');
const parsed = JSON.parse(raw);
const updates = parsed.updates;
if (!Array.isArray(updates) || updates.length === 0) {
  console.error(`No updates[] in ${patchPath}`);
  process.exit(1);
}

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

function shortenName(s, id) {
  const n = String(s).trim();
  if (n.length <= NAME_MAX) return n;
  const cut = n.slice(0, NAME_MAX - 13) + '… (trunc)';
  console.warn(`WARN name > ${NAME_MAX} chars for ${id}; truncating`);
  return cut.slice(0, NAME_MAX);
}

await client.connect();

const plan = [];

for (const u of updates) {
  const id = u.id;
  if (!id || typeof id !== 'string') {
    console.error('Skipping row without string id:', u);
    process.exitCode = 1;
    continue;
  }
  const r = await client.query(
    `SELECT id, name, location, city, state, country, sports_supported
     FROM turfs WHERE id = $1`,
    [id],
  );
  if (r.rows.length === 0) {
    console.error(`MISSING turf id ${id} (skipped)`);
    process.exitCode = 1;
    continue;
  }
  const row = r.rows[0];
  const next = {
    name: shortenName(u.name ?? row.name, id),
    location: u.location != null ? String(u.location).trim() : row.location,
    city: u.city != null ? String(u.city).trim() : row.city,
    state: u.state != null ? String(u.state).trim() : row.state,
    country: u.country != null ? String(u.country).trim() : row.country,
  };
  plan.push({ id, before: row, after: next });
}

const noop = [];
const changes = [];

for (const step of plan) {
  const b = step.before;
  const a = step.after;
  const same =
    b.name === a.name &&
    (b.location ?? '') === (a.location ?? '') &&
    (b.city ?? '') === (a.city ?? '') &&
    (b.state ?? '') === (a.state ?? '') &&
    (b.country ?? '') === (a.country ?? '');
  if (same) noop.push(step.id);
  else changes.push(step);
}

console.log(
  JSON.stringify(
    {
      patchPath,
      mode: APPLY ? 'APPLY' : 'DRY_RUN',
      turfRowsTargeted: updates.length,
      unchanged: noop.length,
      willChange: changes.length,
      changesPreview: changes.map((c) => ({
        id: c.id,
        sports_supported_unchanged: c.before.sports_supported,
        from: {
          name: c.before.name,
          location: c.before.location,
          city: c.before.city,
          state: c.before.state,
          country: c.before.country,
        },
        to: {
          name: c.after.name,
          location: c.after.location,
          city: c.after.city,
          state: c.after.state,
          country: c.after.country,
        },
      })),
    },
    null,
    2,
  ),
);

if (APPLY && changes.length > 0) {
  await client.query('BEGIN');
  try {
    for (const c of changes) {
      await client.query(
        `UPDATE turfs
         SET name = $2,
             location = $3,
             city = $4,
             state = $5,
             country = $6,
             updated_at = now()
         WHERE id = $1`,
        [
          c.id,
          c.after.name,
          c.after.location,
          c.after.city,
          c.after.state,
          c.after.country,
        ],
      );
    }
    await client.query('COMMIT');
    console.log(`COMMITTED ${changes.length} row(s).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ROLLBACK:', e.message);
    process.exit(1);
  }
} else if (APPLY) {
  console.log('Nothing to update; transaction skipped.');
} else if (changes.length > 0) {
  console.log('\nDry-run only. Run with --apply after review.');
}

await client.end();
