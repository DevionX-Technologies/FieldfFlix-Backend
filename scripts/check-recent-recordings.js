const { Client } = require('pg');

async function main() {
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
    const result = await client.query(
      `SELECT r.id, r."cameraId", r."startTime", r."endTime", r.status, r."raspberryPiRecordingId",
              c.name AS camera_name, t.name AS turf_name
       FROM recordings r
       LEFT JOIN cameras c ON r."cameraId" = c.id
       LEFT JOIN turfs t ON c."turfId" = t.id
       ORDER BY r."startTime" DESC
       LIMIT 20`,
    );
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.error('Error listing recent recordings:', error);
  } finally {
    await client.end();
  }
}

main();
