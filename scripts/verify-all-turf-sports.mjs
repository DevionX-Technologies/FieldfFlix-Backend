/**
 * Read-only: list every turf and its `sports_supported` enum array.
 *
 * Usage:
 *   node scripts/verify-all-turf-sports.mjs
 *   npm run db:verify-turfs
 */
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Client } = pg;

const sql = `
SELECT id, name, city, sports_supported
FROM turfs
ORDER BY name NULLS LAST, id
`;

const c = new Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

await c.connect();
const r = await c.query(sql);
const rows = r.rows;

const bySupport = new Map();
for (const row of rows) {
  const key = String(row.sports_supported ?? 'NULL');
  bySupport.set(key, (bySupport.get(key) ?? 0) + 1);
}

console.log(
  JSON.stringify(
    {
      totalTurfs: rows.length,
      countBySportsSupported: Object.fromEntries(
        [...bySupport.entries()].sort((a, b) => b[1] - a[1]),
      ),
      turfs: rows,
    },
    null,
    2,
  ),
);
await c.end();
