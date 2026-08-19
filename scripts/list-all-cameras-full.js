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
    const res = await client.query(
      `SELECT id, name, "raspberryPiBaseUrl" FROM cameras`,
    );
    console.log(`Total cameras: ${res.rows.length}`);
    res.rows.forEach((r) => {
      console.log(
        `ID: ${r.id} | Name: ${r.name} | Url: ${r.raspberryPiBaseUrl}`,
      );
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
