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
    // 1. List all tables
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    console.log('\n--- Database Tables ---');
    console.table(tables.rows);

    // 2. Describe cameras table columns
    const cameraCols = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'cameras'`,
    );
    console.log('\n--- Cameras Table Columns ---');
    console.table(cameraCols.rows);
  } catch (error) {
    console.error('Error describing schema:', error);
  } finally {
    await client.end();
  }
}

main();
