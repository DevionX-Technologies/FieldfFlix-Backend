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
      `SELECT c.id, c.name, c.court_number, c."raspberryPiBaseUrl", t.name AS turf_name
       FROM cameras c
       LEFT JOIN turfs t ON c."turfId" = t.id
       ORDER BY t.name, c.court_number, c.name`,
    );

    console.table(
      result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        court: r.court_number,
        turf: r.turf_name,
        pinggyUrl: r.raspberryPiBaseUrl || 'NULL',
      })),
    );
  } catch (error) {
    console.error('Error listing cameras:', error);
  } finally {
    await client.end();
  }
}

main();
