/**
 * List turfs matching known venue name patterns + sample of all turfs.
 *   node scripts/check-turf-arenas.mjs
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Client } = pg;
const c = new Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

const sql = `
SELECT id, name, city, sports_supported
FROM turfs
WHERE name ILIKE '%eskay%'
   OR name ILIKE '%balkanji%'
   OR name ILIKE '%tsg padel%'
   OR name ILIKE '%pickpad%'
   OR name ILIKE '%pickleflow%'
   OR name ILIKE '%botanical%'
ORDER BY name;
`;

try {
  await c.connect();
  const r = await c.query(sql);
  const total = await c.query('SELECT count(*)::int AS n FROM turfs');
  console.log(JSON.stringify({ matchCount: r.rows.length, totalTurfs: total.rows[0].n, matches: r.rows }, null, 2));

  const list = await c.query(
    `SELECT name, city FROM turfs ORDER BY name LIMIT 80`,
  );
  console.log('\n--- Sample of turfs in DB (first 80 by name) ---');
  for (const row of list.rows) {
    console.log(`- ${row.name} | ${row.city ?? ''}`);
  }
  await c.end();
} catch (e) {
  console.error('FAILED:', e.code || '', e.message);
  process.exit(1);
}
