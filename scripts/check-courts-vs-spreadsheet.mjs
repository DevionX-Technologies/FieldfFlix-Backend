/**
 * Compare spreadsheet venues/courts vs DB: turfs + cameras per turf.
 *   node scripts/check-courts-vs-spreadsheet.mjs
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Client } = pg;

/** Expected from user table: arena label pattern, location hint, expected court count, notes */
const EXPECTED = [
  {
    key: 'eskay',
    pattern: '%eskay%',
    location: 'Borivali West',
    courts: 4,
    sport: 'Pickleball',
  },
  {
    key: 'balkanji',
    pattern: '%balkanji%',
    location: 'Santacruz West',
    courts: 3,
    sport: 'Pickleball courts 1–3 (cricket venue is separate Santacruz row in ops sheet)',
  },
  {
    key: 'padel_arena',
    pattern: '%tsg padel%',
    location: 'Goregaon East',
    courts: 2,
    sport: 'Padel',
  },
  {
    key: 'pickpad',
    pattern: '%pickpad%',
    location: 'Goregaon West',
    courts: 1,
    sport: 'Padel',
  },
  {
    key: 'pickleflow',
    pattern: '%pickleflow%',
    location: 'Noida',
    courts: 3,
    sport: 'Pickleball',
  },
  {
    key: 'botanical',
    pattern: '%botanical%',
    location: 'Andheri West',
    courts: 4,
    sport: 'Pickleball; venue labels courts 3–6 (four live rows)',
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

function courtHint(name) {
  if (name == null) return '';
  const m = String(name).match(/(\d+)/);
  return m ? m[1] : '';
}

await client.connect();

const report = [];

for (const row of EXPECTED) {
  const turfs = await client.query(
    `SELECT id, name, city, sports_supported
     FROM turfs
     WHERE name ILIKE $1
     ORDER BY name`,
    [row.pattern],
  );

  const block = {
    spreadsheet: row,
    turfRows: turfs.rows.length,
    turfs: [],
    totalCameras: 0,
    verdict: '',
  };

  for (const t of turfs.rows) {
    const cams = await client.query(
      `SELECT id, name, "turfId"
       FROM cameras
       WHERE "turfId" = $1
       ORDER BY name NULLS LAST, id`,
      [t.id],
    );
    block.totalCameras += cams.rows.length;
    block.turfs.push({
      turfId: t.id,
      turfName: t.name,
      city: t.city,
      sports_supported: t.sports_supported,
      cameraCount: cams.rows.length,
      cameras: cams.rows.map((c) => ({
        id: c.id,
        name: c.name,
        digitInName: courtHint(c.name),
      })),
    });
  }

  const exp = row.courts;
  const got = block.totalCameras;
  if (block.turfRows === 0) {
    block.verdict = 'NO_TURF_MATCH';
  } else if (got === exp) {
    block.verdict = 'CAMERA_COUNT_MATCHES';
  } else if (got > exp) {
    block.verdict = `EXTRA_CAMERAS (DB ${got} vs sheet ${exp})`;
  } else {
    block.verdict = `MISSING_CAMERAS (DB ${got} vs sheet ${exp})`;
  }

  report.push(block);
}

// Santacruz-only turfs (sheet row not in balkanji pattern sometimes)
const santacruz = await client.query(
  `SELECT t.id, t.name, t.city, COUNT(c.id)::int AS cam_count
   FROM turfs t
   LEFT JOIN cameras c ON c."turfId" = t.id
   WHERE t.name ILIKE '%santacruz%'
   GROUP BY t.id, t.name, t.city
   ORDER BY t.name`,
);

console.log(JSON.stringify({ byVenue: report, santacruzTurfs: santacruz.rows }, null, 2));

await client.end();
