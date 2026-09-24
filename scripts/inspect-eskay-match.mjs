/**
 * Inspects the most recent Eskay Resorts match in the database to debug the pipeline state.
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Client } = pg;
const client = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'neondb_owner',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'neondb',
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log('🔍 Inspecting recent Eskay Resorts recordings...\n');

  const sql = `
    SELECT 
      r.id AS recording_id,
      r.status,
      r."startTime" AS start_time,
      r."endTime" AS end_time,
      r.recording_name,
      r.mux_playback_id,
      r.mux_asset_id,
      r."s3Path" AS s3_path,
      r.metadata,
      t.name AS turf_name,
      c.name AS camera_name,
      c.court_number,
      c."raspberryPiBaseUrl" AS pi_base_url,
      u.phone_number,
      r.updated_at
    FROM recordings r
    LEFT JOIN turfs t ON t.id = r."turfId"
    LEFT JOIN cameras c ON c.id = r."cameraId"
    LEFT JOIN users u ON u.id = r."userId"
    ORDER BY r.updated_at DESC
    LIMIT 5;
  `;

  const res = await client.query(sql);

  if (res.rows.length === 0) {
    console.log('No recordings found in the database.');
    await client.end();
    return;
  }

  console.log(`Found ${res.rows.length} recent recordings in database:\n`);
  res.rows.forEach((row, i) => {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`📹 [${i + 1}] Recording ID: ${row.recording_id}`);
    console.log(`    Turf:          ${row.turf_name} (Court #${row.court_number || 1})`);
    console.log(`    Camera:        ${row.camera_name} | Pi: ${row.pi_base_url || 'None'}`);
    console.log(`    User Phone:    ${row.phone_number}`);
    console.log(`    Start Time:    ${row.start_time}`);
    console.log(`    End Time:      ${row.end_time}`);
    console.log(`    Status:        ${row.status}`);
    console.log(`    Mux/CF ID:     ${row.mux_playback_id}`);
    console.log(`    S3/R2 Path:    ${row.s3_path}`);
    console.log(`    Metadata:      ${JSON.stringify(row.metadata, null, 2)}`);
    console.log(`    Last Updated:  ${row.updated_at}`);
  });

  await client.end();
}

main().catch((err) => {
  console.error('Error inspecting recording:', err);
  process.exit(1);
});
