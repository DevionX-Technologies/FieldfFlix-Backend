/**
 * One-off inventory: total cameras + per-turf counts.
 *   node scripts/count-cameras.mjs
 */
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const c = new pg.Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

await c.connect();
const totalCams = await c.query('SELECT count(*)::int AS n FROM cameras');
const camsPerTurf = await c.query(`
  SELECT t.id, t.name, COUNT(c.id)::int AS camera_count
  FROM turfs t
  LEFT JOIN cameras c ON c."turfId" = t.id
  GROUP BY t.id, t.name
  ORDER BY camera_count ASC, t.name
`);
let sum = 0;
for (const r of camsPerTurf.rows) sum += r.camera_count;

console.log(
  JSON.stringify(
    {
      totalCamerasInDb: totalCams.rows[0].n,
      sumCamerasOnTurfs: sum,
      sheetCourtCountOps: 18,
      turfsCount: camsPerTurf.rows.length,
      turfsWithZeroCameras: camsPerTurf.rows
        .filter((r) => r.camera_count === 0)
        .map((r) => ({ id: r.id, name: r.name })),
      perTurf: camsPerTurf.rows,
    },
    null,
    2,
  ),
);
await c.end();
