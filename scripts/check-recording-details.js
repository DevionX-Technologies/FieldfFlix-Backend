const { Client } = require('pg');

async function main() {
  const recordingId = process.argv[2];
  if (!recordingId) {
    console.error(
      'Usage: node scripts/check-recording-details.js <recordingId_or_piRecordingId>',
    );
    process.exit(1);
  }

  const sslOn = process.env.DB_SSL !== 'false';
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: sslOn ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  console.log('Connected to DB');

  try {
    console.log(`\n--- Fetching details for ID: ${recordingId} ---`);

    const recResult = await client.query(
      `SELECT r.*, c.name AS camera_name, c."raspberryPiBaseUrl", c.court_number, t.name AS turf_name
       FROM recordings r
       LEFT JOIN cameras c ON r."cameraId" = c.id
       LEFT JOIN turfs t ON c."turfId" = t.id
       WHERE r.id::text = $1 OR r."raspberryPiRecordingId"::text = $1`,
      [recordingId],
    );

    if (recResult.rows.length === 0) {
      console.log('Recording not found in DB');
    } else {
      console.log(JSON.stringify(recResult.rows[0], null, 2));
    }
  } catch (error) {
    console.error('Error querying DB:', error);
  } finally {
    await client.end();
  }
}

main();
