/**
 * Finds all real venues and courts in the database that have 2-3 camera angles,
 * displaying their active Raspberry Pi bridge endpoints, court numbers, and sports.
 *
 * Usage:
 *   node scripts/find-multi-cam-courts.mjs
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
  console.log('🔍 Searching database for active courts with 2-3 cameras...\n');

  const sql = `
    SELECT 
      t.id AS turf_id,
      t.name AS turf_name,
      t.city,
      t.sports_supported,
      COUNT(c.id) AS camera_count,
      json_agg(
        json_build_object(
          'camera_id', c.id,
          'camera_name', c.name,
          'court_number', c.court_number,
          'pi_base_url', c."raspberryPiBaseUrl",
          'is_active', c.is_active,
          'recording_count', (SELECT COUNT(*) FROM recordings r WHERE r."cameraId" = c.id)
        ) ORDER BY c.court_number ASC, c.name ASC
      ) AS cameras
    FROM turfs t
    JOIN cameras c ON c."turfId" = t.id
    WHERE t.hidden_from_app = false
    GROUP BY t.id, t.name, t.city, t.sports_supported
    ORDER BY camera_count DESC, t.name ASC;
  `;

  const res = await client.query(sql);

  if (res.rows.length === 0) {
    console.log('No venues found with attached cameras.');
    await client.end();
    return;
  }

  console.log(`Found ${res.rows.length} venues with connected camera angles:\n`);

  res.rows.forEach((venue, index) => {
    console.log(`================================================================================`);
    console.log(`🏟️  [${index + 1}] Venue: ${venue.turf_name} (${venue.city || 'Mumbai'})`);
    console.log(`    Turf ID: ${venue.turf_id}`);
    console.log(`    Sports:  ${Array.isArray(venue.sports_supported) ? venue.sports_supported.join(', ') : venue.sports_supported}`);
    console.log(`    Total Cameras: ${venue.camera_count}`);
    console.log(`--------------------------------------------------------------------------------`);
    
    venue.cameras.forEach((cam, camIdx) => {
      console.log(`    📹 Angle ${camIdx + 1}: ${cam.camera_name} (Court #${cam.court_number || 1})`);
      console.log(`       Camera ID:   ${cam.camera_id}`);
      console.log(`       Pi Bridge:   ${cam.pi_base_url || 'N/A'}`);
      console.log(`       Past Games:  ${cam.recording_count}`);
    });
    console.log(`================================================================================\n`);
  });

  await client.end();
}

main().catch((err) => {
  console.error('Error finding courts:', err);
  process.exit(1);
});
