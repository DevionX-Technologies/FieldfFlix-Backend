/**
 * For UUID ↔ turf verification against the ops spreadsheet, prefer:
 *
 *   npm run db:audit-turf-cameras
 *
 * Reads FieldFlix-Backend-clean/.env (DB_*).
 */
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const hasCourtColRes = await client.query(`
  SELECT 1 AS ok
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'cameras'
    AND column_name = 'court_number'
  LIMIT 1
`);
const hasCourtNumberColumn = hasCourtColRes.rowCount > 0;

const flat = await client.query(`
  SELECT
    t.id AS turf_id,
    t.name AS turf_name,
    t.location,
    t.city,
    t.sports_supported,
    t.is_active,
    c.id AS camera_id,
    c.name AS camera_name,
    ${hasCourtNumberColumn ? 'c."court_number"' : 'NULL::integer'} AS court_number
  FROM turfs t
  LEFT JOIN cameras c ON c."turfId" = t.id
  ORDER BY t.name NULLS LAST, t.id::text, c.name NULLS LAST, c.id::text
`);

const byTurf = new Map();

for (const row of flat.rows) {
  if (!byTurf.has(row.turf_id)) {
    byTurf.set(row.turf_id, {
      turf_id: row.turf_id,
      turf_name: row.turf_name,
      location: row.location,
      city: row.city,
      sports_supported: row.sports_supported,
      is_active: row.is_active,
      cameras: [],
    });
  }
  if (row.camera_id) {
    byTurf.get(row.turf_id).cameras.push({
      camera_id: row.camera_id,
      camera_name: row.camera_name,
      court_number: row.court_number,
    });
  }
}

const turfList = [...byTurf.values()];

const totals = await client.query(`
  SELECT count(*)::int AS turfs,
         count(*) FILTER (WHERE is_active = true)::int AS turfs_active
  FROM turfs
`);

const camCount = await client.query(`SELECT count(*)::int AS n FROM cameras`);

console.log(
  JSON.stringify(
    {
      totals: {
        turfs_in_db: totals.rows[0].turfs,
        turfs_is_active_true: totals.rows[0].turfs_active,
        cameras_in_db: camCount.rows[0].n,
      },
      cameras_court_number_column_present: hasCourtNumberColumn,
      migration_hint: hasCourtNumberColumn
        ? undefined
        : 'Add cameras.court_number via backend migrations (npm run migration:run); court_number shown as null until then.',
      turfCameraMatrix: turfList.map((t) => ({
        ...t,
        camera_count: t.cameras.length,
      })),
      flat_join_rows: flat.rows,
    },
    null,
    2,
  ),
);

await client.end();
