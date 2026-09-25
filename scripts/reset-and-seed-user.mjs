import pg from 'pg';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

dotenv.config();

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log('Connected to database', process.env.DB_DATABASE);

  // 1. Truncate operational and user tables
  const tablesToTruncate = [
    'recordings',
    'recording_highlights',
    'recording_highlight_engagements',
    'flick_shorts',
    'shared_recordings',
    'games',
    'payments',
    'user_points',
    'point_events',
    'user_achievements',
    'user_achievement_metrics',
    'user_devices_token',
    'notification',
    'webhook_events',
    'coupon_redemptions',
    'coupon_assignments',
    'media_uploads',
    'support_contact_submission',
    'tournament_enrollments',
    'users',
  ];

  console.log('Truncating tables:', tablesToTruncate.join(', '));
  await client.query(`TRUNCATE TABLE ${tablesToTruncate.join(', ')} CASCADE;`);
  console.log('Successfully truncated all operational data!');

  // 2. Re-seed turfs and cameras
  console.log('Seeding turfs and cameras...');
  execSync('node scripts/seed-fleet-venues.mjs --apply', { stdio: 'inherit' });

  // 3. Insert fresh user for 111111111
  const userId = randomUUID();
  const phone = '+91111111111';
  const email = 'user111111111@fieldflicks.com';
  const name = 'Test User';

  const userRes = await client.query(
    `INSERT INTO users (
      id, name, phone_number, email, preferred_sports, "singUp_Method", created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'phone_number', NOW(), NOW())
    RETURNING id, name, phone_number, email;`,
    [userId, name, phone, email, JSON.stringify(['Pickleball'])]
  );

  console.log('Created new user:', userRes.rows[0]);

  await client.end();
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
