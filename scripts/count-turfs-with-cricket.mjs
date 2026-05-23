/**
 * Count turfs (courts/venues) that list Cricket in sports_supported.
 *   node scripts/count-turfs-with-cricket.mjs
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Client } = pg;

const client = new Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const countRes = await client.query(`
  SELECT COUNT(*)::int AS n
  FROM turfs
  WHERE sports_supported @> ARRAY['Cricket']::"ESportsSupported"[]
`);

const listRes = await client.query(`
  SELECT id, name, city, sports_supported
  FROM turfs
  WHERE sports_supported @> ARRAY['Cricket']::"ESportsSupported"[]
  ORDER BY name
`);

console.log(`Database: ${process.env.DB_DATABASE || 'fieldflicks-dev (default)'}`);
console.log(`Turfs with Cricket in sports_supported: ${countRes.rows[0].n}`);
console.log('');
for (const r of listRes.rows) {
  console.log(`  - ${r.name} (${r.city || '?'})`);
  console.log(`    id: ${r.id}  sports: ${JSON.stringify(r.sports_supported)}`);
}

await client.end();
