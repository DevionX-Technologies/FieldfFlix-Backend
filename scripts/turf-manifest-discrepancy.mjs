/**
 * Read-only report: ops spreadsheet snapshot (7 venues, 18 courts) vs DB `turfs`.
 * Does not modify data. Use this before writing an apply migration.
 *
 * Usage:
 *   node scripts/turf-manifest-discrepancy.mjs
 *   npm run db:turf-manifest-report
 */
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Client } = pg;

/** Venues from spreadsheet; `whereSql` counts turf *rows* expected for that venue block. */
const VENUE_BLOCKS = [
  {
    key: 'eskay',
    label: 'TSG Sports Arena | Eskay Resort',
    whereSql: `(name ILIKE '%eskay%' OR name ILIKE '%Eskay%')`,
    expectedTurfRows: 4,
    locationLabel: 'Borivali West, Mumbai',
    city: 'Mumbai',
    spreadsheetSports: ['Pickleball'],
    courtNosNote: 'Courts 1–4',
  },
  {
    key: 'balkanji_pickle',
    label: 'TSG Sports Arena | All India Balkanji Bari (pickle)',
    whereSql: `(name ILIKE '%balkanji%' OR name ILIKE '%Balkanji%') AND sports_supported @> ARRAY['Pickleball']::"ESportsSupported"[]`,
    expectedTurfRows: 3,
    locationLabel: 'Santacruz West, Mumbai',
    city: 'Mumbai',
    spreadsheetSports: ['Pickleball'],
    courtNosNote: 'Courts 1–3; note "Reserved for emergency"',
  },
  {
    key: 'santacruz_cricket',
    label: 'TSG Sports Arena | Santacruz West (cricket)',
    whereSql: `(name ILIKE '%santacruz%' OR name ILIKE '%Santacruz%') AND name NOT ILIKE '%balkanji%' AND sports_supported @> ARRAY['Cricket']::"ESportsSupported"[]`,
    expectedTurfRows: 1,
    locationLabel: 'Santacruz West, Mumbai',
    city: 'Mumbai',
    spreadsheetSports: ['Cricket'],
    courtNosNote: 'Court 1',
  },
  {
    key: 'tsg_padel',
    label: 'TSG Padel Arena',
    whereSql: `name ILIKE '%tsg padel%' OR name ILIKE '%TSG Padel%'`,
    expectedTurfRows: 2,
    locationLabel: 'Goregaon East, Mumbai',
    city: 'Mumbai',
    spreadsheetSports: ['Paddle'],
    courtNosNote: 'Courts 1–2 (DB enum: Paddle)',
  },
  {
    key: 'pickpad',
    label: 'PickPad by Aim Sports',
    whereSql: `name ILIKE '%pickpad%' OR name ILIKE '%PickPad%'`,
    expectedTurfRows: 1,
    locationLabel: 'Goregaon West, Mumbai',
    city: 'Mumbai',
    spreadsheetSports: ['Paddle'],
    courtNosNote: 'Court 1 — expect duplicate legacy rows to merge',
  },
  {
    key: 'pickleflow',
    label: 'Pickleflow Social',
    whereSql: `name ILIKE '%pickleflow%' OR name ILIKE '%Pickleflow%'`,
    expectedTurfRows: 3,
    locationLabel: 'Noida',
    city: 'Noida',
    spreadsheetSports: ['Pickleball'],
    courtNosNote: 'Courts 1–3',
  },
  {
    key: 'botanical',
    label: 'TSG Pickleball and Sports Arena | Botanical Gardens',
    whereSql: `name ILIKE '%botanical%'`,
    expectedTurfRows: 4,
    locationLabel: 'Andheri West, Mumbai',
    city: 'Mumbai',
    spreadsheetSports: ['Pickleball'],
    courtNosNote: 'Courts 3–6 in venue (four live rows)',
  },
];

function rowProblemFlags(row) {
  const cityEmpty = !row.city || String(row.city).trim() === '';
  const locEmpty = !row.location || String(row.location).trim() === '';
  return { cityEmpty, locEmpty, needsLocationWork: cityEmpty || locEmpty };
}

const client = new Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  const totals = await client.query(`SELECT count(*)::int AS n FROM turfs`);

  const coverage = await client.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE city IS NOT NULL AND btrim(city) <> '')::int AS has_city,
      count(*) FILTER (WHERE location IS NOT NULL AND btrim(location) <> '')::int AS has_location
    FROM turfs
  `);

  const byVenue = [];
  const seenIds = new Set();

  for (const block of VENUE_BLOCKS) {
    const r = await client.query(
      `SELECT id, name, city, location, state, country, sports_supported, is_active
       FROM turfs
       WHERE ${block.whereSql}
       ORDER BY name, id`,
    );
    for (const row of r.rows) {
      seenIds.add(row.id);
    }

    const exp = block.expectedTurfRows;
    const got = r.rows.length;
    let countVerdict = 'MATCH';
    if (got === 0) countVerdict = 'NO_ROWS';
    else if (got < exp) countVerdict = `MISSING (${got} vs ${exp} expected)`;
    else if (got > exp) countVerdict = `EXTRA (${got} vs ${exp} expected)`;

    byVenue.push({
      spreadsheet: {
        key: block.key,
        label: block.label,
        expectedTurfRows: exp,
        locationLabel: block.locationLabel,
        suggestedCity: block.city,
        sports: block.spreadsheetSports,
        note: block.courtNosNote,
      },
      dbTurfRowCount: got,
      countVerdict,
      turfs: r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        location: row.location,
        sports_supported: row.sports_supported,
        flags: rowProblemFlags(row),
      })),
    });
  }

  const unionSql = VENUE_BLOCKS.map((b) => `(${b.whereSql})`).join(' OR ');
  const allScoped = await client.query(
    `SELECT id, name, city, location, sports_supported
     FROM turfs
     WHERE ${unionSql}
     ORDER BY name`,
  );
  const scopedIds = new Set(allScoped.rows.map((row) => row.id));

  const globalOther = await client.query(
    `SELECT id, name, city, location, sports_supported
     FROM turfs
     WHERE NOT (${unionSql})
     ORDER BY name`,
  );

  /** Cricket turf row labeled as Balkanji (sheet assigns cricket to Santacruz West venue). */
  const cricketMislabel = await client.query(`
    SELECT id, name, city, location, sports_supported
    FROM turfs
    WHERE name ILIKE '%balkanji%'
      AND sports_supported @> ARRAY['Cricket']::"ESportsSupported"[]
  `);

  const duplicateSantacruzNames = await client.query(`
    SELECT name,
           count(*)::int AS turf_rows,
           array_agg(id ORDER BY id) AS turf_ids,
           array_agg(sports_supported::text ORDER BY id) AS sports
    FROM turfs
    WHERE name ILIKE '%santacruz%'
      AND name NOT ILIKE '%balkanji%'
    GROUP BY name
    HAVING count(*) > 1
  `);

  const expectedTotalCourts = VENUE_BLOCKS.reduce(
    (a, b) => a + b.expectedTurfRows,
    0,
  );

  const summary = {
    spreadsheetUniqueVenues: VENUE_BLOCKS.length,
    spreadsheetExpectedTurfRows: expectedTotalCourts,
    databaseTotalTurfRows: totals.rows[0].n,
    databaseRowsMatchingAnyVenuePattern: scopedIds.size,
    databaseRowsOutsideVenuePatterns: globalOther.rows.length,
    locationCoverageAllTurfs: coverage.rows[0],
    venueBlocksWithMismatch: byVenue.filter((v) => v.countVerdict !== 'MATCH').length,
  };

  console.log(
    JSON.stringify(
      {
        summary,
        byVenue,
        unmatchedTurfsOutsideSpreadsheetVenues: globalOther.rows.map((row) => ({
          ...row,
          flags: rowProblemFlags(row),
        })),
        anomalies: {
          balkanjiNameButCricketSport: cricketMislabel.rows.map((row) => ({
            id: row.id,
            name: row.name,
            city: row.city,
            location: row.location,
            sports_supported: row.sports_supported,
            note:
              'Spreadsheet maps cricket to "TSG Sports Arena | Santacruz West"; verify cameras/recordings before renaming or merging.',
          })),
          possibleDuplicateVenueTurfsSameName:
            duplicateSantacruzNames.rows.map((row) => ({
              name: row.name,
              turfRowCount: row.turf_rows,
              turfIds: row.turf_ids,
              sportsArrays: row.sports,
              note:
                'Two turf rows share the Santacruz display name — usually one cricket and one pickle; consolidate after checking FKs.',
            })),
        },
      },
      null,
      2,
    ),
  );

  await client.end();
} catch (e) {
  console.error('FAILED:', e.code ?? '', e.message);
  await client.end().catch(() => {});
  process.exit(1);
}
