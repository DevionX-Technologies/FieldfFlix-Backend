/**
 * Show every camera at a venue, plus its turf's `sports_supported` and how
 * many recordings have been made on that camera.
 *
 * Helps answer "which court is cricket vs pickleball today?" — the answer is
 * whichever turf row the camera belongs to and what sports that row carries.
 *
 * Usage:
 *   node scripts/list-cameras-at-venue.mjs                          # default Santacruz
 *   node scripts/list-cameras-at-venue.mjs --pattern '%Eskay%'
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const patternIdx = args.indexOf('--pattern');
const pattern =
  patternIdx >= 0 && args[patternIdx + 1]
    ? args[patternIdx + 1]
    : '%Santacruz West%';

function coerceSportsSupported(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  const s = String(raw).trim();
  if (s.startsWith('{') || s.startsWith('(')) {
    return s
      .replace(/^[{(]/, '')
      .replace(/[)}]$/, '')
      .split(',')
      .map((x) => x.replace(/"/g, '').trim())
      .filter(Boolean);
  }
  return [s];
}

const { Client } = pg;
const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const sql = `
  SELECT t.id   AS turf_id,
         t.name AS turf_name,
         t.sports_supported,
         c.id   AS camera_id,
         c.name AS camera_name,
         (SELECT COUNT(*)::int FROM recordings r WHERE r."cameraId" = c.id) AS recording_count
    FROM turfs t
    LEFT JOIN cameras c ON c."turfId" = t.id
   WHERE t.name ILIKE $1
   ORDER BY t.name, c.name NULLS LAST
`;
const res = await client.query(sql, [pattern]);

const grouped = {};
for (const r of res.rows) {
  const sports = coerceSportsSupported(r.sports_supported);
  const sportLabel =
    sports.length === 0 ? 'NONE' : sports.length === 1 ? sports[0] : sports.join('+');
  const key = `${r.turf_id} | ${r.turf_name} | ${sportLabel}`;
  if (!grouped[key]) grouped[key] = [];
  if (r.camera_id) {
    grouped[key].push({
      camera_id: r.camera_id,
      camera_name: r.camera_name,
      recording_count: r.recording_count,
    });
  }
}

console.log(JSON.stringify({ pattern, byTurf: grouped }, null, 2));

await client.end();
