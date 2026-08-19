#!/usr/bin/env node
/**
 * Seed turfs + cameras from the FieldFlicks venue spreadsheet.
 * Run: node scripts/seed-fleet-venues.mjs [--apply]
 * Requires DB_* env vars (loads .env).
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const PI_PICKPAD = 'https://raspberrypi-court11.taild82368.ts.net';

const TURF_IDS = {
  eskay: 'a1000001-0001-4001-8001-000000000001',
  balkanji: 'a1000002-0002-4002-8002-000000000002',
  santacruzCricket: 'a1000003-0003-4003-8003-000000000003',
  padelGoregaon: 'a1000004-0004-4004-8004-000000000004',
  pickpad: '91238da1-a073-41b5-86a4-2cf873c33259',
  pickleflow: 'a1000006-0006-4006-8006-000000000006',
  botanical: 'a1000007-0007-4007-8007-000000000007',
};

/** @type {Array<{ name: string; location: string; city: string; state: string; sport: string; turfId: string; courts: Array<{ id: string; courtNumber: number; name?: string; piUrl?: string | null }> }>} */
const VENUES = [
  {
    name: 'TSG Sports Arena | Eskay Resort',
    location: 'Borivali West',
    city: 'Mumbai',
    state: 'Maharashtra',
    sport: 'Pickleball',
    turfId: TURF_IDS.eskay,
    courts: [
      { id: '27ce1af1-721a-421c-9223-3ddeda95f329', courtNumber: 1 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f318', courtNumber: 2 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f319', courtNumber: 3 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f31a', courtNumber: 4 },
    ],
  },
  {
    name: 'TSG Pickleball Arena | All India Balkanji Bari',
    location: 'Santacruz West',
    city: 'Mumbai',
    state: 'Maharashtra',
    sport: 'Pickleball',
    turfId: TURF_IDS.balkanji,
    courts: [
      { id: '27ce1af1-721a-421c-9223-3ddeda95f31b', courtNumber: 1 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f31c', courtNumber: 2 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f31d', courtNumber: 3 },
    ],
  },
  {
    name: 'TSG Sports Arena | Santacruz West',
    location: 'Santacruz West',
    city: 'Mumbai',
    state: 'Maharashtra',
    sport: 'Cricket',
    turfId: TURF_IDS.santacruzCricket,
    courts: [{ id: '27ce1af1-721a-421c-9223-3ddeda95f316', courtNumber: 1 }],
  },
  {
    name: 'TSG Padel Arena',
    location: 'Goregaon East',
    city: 'Mumbai',
    state: 'Maharashtra',
    sport: 'Paddle',
    turfId: TURF_IDS.padelGoregaon,
    courts: [
      { id: '27ce1af1-721a-421c-9223-3ddeda95f31f', courtNumber: 1 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f320', courtNumber: 2 },
    ],
  },
  {
    name: 'PickPad by Aim Sports',
    location: 'Goregaon West',
    city: 'Mumbai',
    state: 'Maharashtra',
    sport: 'Paddle',
    turfId: TURF_IDS.pickpad,
    courts: [
      {
        id: '27ce1af1-721a-421c-9223-3ddeda95f321',
        courtNumber: 1,
        piUrl: PI_PICKPAD,
      },
    ],
  },
  {
    name: 'Pickleflow Social',
    location: 'Noida',
    city: 'Noida',
    state: 'Uttar Pradesh',
    sport: 'Pickleball',
    turfId: TURF_IDS.pickleflow,
    courts: [
      { id: '27ce1af1-721a-421c-9223-3ddeda95f322', courtNumber: 1 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f323', courtNumber: 2 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f324', courtNumber: 3 },
    ],
  },
  {
    name: 'TSG Pickleball and Sports Arena | Botanical Gardens',
    location: 'Andheri West',
    city: 'Mumbai',
    state: 'Maharashtra',
    sport: 'Pickleball',
    turfId: TURF_IDS.botanical,
    courts: [
      { id: '27ce1af1-721a-421c-9223-3ddeda95f325', courtNumber: 1 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f326', courtNumber: 2 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f327', courtNumber: 3 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f328', courtNumber: 4 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f32b', courtNumber: 5 },
      { id: '27ce1af1-721a-421c-9223-3ddeda95f32c', courtNumber: 6 },
    ],
  },
];

async function main() {
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  let turfCount = 0;
  let cameraCount = 0;

  for (const venue of VENUES) {
    const turfId = venue.turfId || randomUUID();
    console.log(`\n[venue] ${venue.name} (${turfId})`);

    if (APPLY) {
      await client.query(
        `INSERT INTO turfs (
          id, name, city, state, country, location, sports_supported, surface_type,
          opening_time, closing_time, is_active, geo_location, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 'India', $5, $6::"ESportsSupported"[], ARRAY['artificial_Grass']::"ESurfaceType"[],
          '06:00:00', '22:00:00', true,
          ST_SetSRID(ST_MakePoint($7, $8), 4326),
          NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          city = EXCLUDED.city,
          state = EXCLUDED.state,
          location = EXCLUDED.location,
          sports_supported = EXCLUDED.sports_supported,
          updated_at = NOW()`,
        [
          turfId,
          venue.name,
          venue.city,
          venue.state,
          venue.location,
          [venue.sport],
          72.8777,
          19.076,
        ],
      );
    }
    turfCount++;

    for (const court of venue.courts) {
      const camName = court.name || `Court ${court.courtNumber}`;
      console.log(`  [camera] ${camName} → ${court.id}${court.piUrl ? ' (Pi linked)' : ''}`);

      if (APPLY) {
        await client.query(
          `INSERT INTO cameras (id, name, "turfId", "raspberryPiBaseUrl", court_number)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             "turfId" = EXCLUDED."turfId",
             "raspberryPiBaseUrl" = COALESCE(EXCLUDED."raspberryPiBaseUrl", cameras."raspberryPiBaseUrl"),
             court_number = EXCLUDED.court_number`,
          [court.id, camName, turfId, court.piUrl ?? null, court.courtNumber],
        );
      }
      cameraCount++;
    }
  }

  // Remove stale PickPad camera if it was replaced by spreadsheet id
  if (APPLY) {
    const stale = 'e9c4d093-e37b-4ce2-ae64-302293376901';
    await client.query('DELETE FROM cameras WHERE id = $1', [stale]);
  }

  await client.end();

  console.log(`\n${APPLY ? 'Applied' : 'Dry run'}: ${turfCount} venues, ${cameraCount} cameras`);
  if (!APPLY) console.log('Re-run with --apply to write to Neon.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
