/**
 * List every turf with all camera UUIDs (+ court_number) and cross-check cameras from the ops
 * spreadsheet: missing UUIDs, orphan rows, fuzzy turf-name mismatches, court_number deltas.
 *
 * Uses FieldFlix-Backend-clean/.env (DB_*).
 *
 *   node scripts/audit-turf-cameras-uuids.mjs
 *   node scripts/audit-turf-cameras-uuids.mjs --json         # full structured output only
 *   node scripts/audit-turf-cameras-uuids.mjs --json --pretty # JSON + human-readable sections
 *   node scripts/audit-turf-cameras-uuids.mjs --all-ok        # pretty: include OK UUID audit lines
 *
 * npm run db:audit-turf-cameras
 */
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ARG_JSON = process.argv.includes('--json');
/** With `--json`: JSON only unless you also pass `--pretty`. Otherwise human-readable stdout. */
const ARG_PRETTY = process.argv.includes('--pretty') || !ARG_JSON;
/** Pretty mode: include every spreadsheet UUID row, including OK (--all-ok). Default lists problems only in the ASCII section (JSON always has full audit). */
const ARG_ALL_OK = process.argv.includes('--all-ok');

/** Ops-sheet cameras: full UUID → expected court_number + fuzzy turf gates (PostgreSQL turf `name`). */
const SPREADSHEET_CAMERAS = [
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f329',
    court: 1,
    note: 'Eskay Resort Borivali — Pickleball',
    turfMatch: { anyOf: [/eskay/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f318',
    court: 2,
    note: 'Eskay Resort Borivali — Pickleball',
    turfMatch: { anyOf: [/eskay/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f319',
    court: 3,
    note: 'Eskay Resort Borivali — Pickleball',
    turfMatch: { anyOf: [/eskay/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f31a',
    court: 4,
    note: 'Eskay Resort Borivali — Pickleball',
    turfMatch: { anyOf: [/eskay/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f31b',
    court: 1,
    note: 'Balkanji Bari Santacruz — Pickleball',
    turfMatch: { anyOf: [/balkanji/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f31c',
    court: 2,
    note: 'Balkanji Bari Santacruz — Pickleball',
    turfMatch: { anyOf: [/balkanji/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f31d',
    court: 3,
    note: 'Balkanji Bari Santacruz — Pickleball',
    turfMatch: { anyOf: [/balkanji/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f316',
    court: 1,
    note: 'Santacruz West — Cricket (non-Balkanji row)',
    turfMatch: {
      anyOf: [/santacruz/i],
      noneOf: [/balkanji/i],
    },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f31f',
    court: 1,
    note: 'TSG Padel Arena — Goregaon East',
    /** DB turf name is usually "TSG Padel Arena" (no suburb in title). */
    turfMatch: { anyOf: [/padel/i, /paddle/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f320',
    court: 2,
    note: 'TSG Padel Arena — Goregaon East',
    turfMatch: { anyOf: [/padel/i, /paddle/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f321',
    court: 1,
    note: 'PickPad Aim Sports — Goregaon West',
    /** DB turf name is "PickPad by Aim Sports" (no suburb). */
    turfMatch: { anyOf: [/pick\s*pad/i, /pickpad/i, /aim sports/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f322',
    court: 1,
    note: 'Pickleflow Social — Noida',
    turfMatch: { anyOf: [/pickleflow/i, /noida/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f323',
    court: 2,
    note: 'Pickleflow Social — Noida',
    turfMatch: { anyOf: [/pickleflow/i, /noida/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f324',
    court: 3,
    note: 'Pickleflow Social — Noida',
    turfMatch: { anyOf: [/pickleflow/i, /noida/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f325',
    court: 3,
    note: 'Botanical Gardens Andheri — Pickleball (physical courts 3–6)',
    turfMatch: { anyOf: [/botanical/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f326',
    court: 4,
    note: 'Botanical Gardens Andheri — Pickleball',
    turfMatch: { anyOf: [/botanical/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f327',
    court: 5,
    note: 'Botanical Gardens Andheri — Pickleball',
    turfMatch: { anyOf: [/botanical/i] },
  },
  {
    id: '27ce1af1-721a-421c-9223-3ddeda95f328',
    court: 6,
    note: 'Botanical Gardens Andheri — Pickleball',
    turfMatch: { anyOf: [/botanical/i] },
  },
];

const SHEET_IDS = new Set(SPREADSHEET_CAMERAS.map((x) => x.id));

/** @type {typeof SPREADSHEET_CAMERAS[number]["turfMatch"]} */
function matchTurfName(turfName, rules) {
  const name = turfName || '';
  if (rules.noneOf?.length) {
    for (const re of rules.noneOf) {
      if (re.test(name)) return { ok: false, reason: `forbidden pattern ${re}` };
    }
  }
  if (rules.allOf?.length) {
    for (const re of rules.allOf) {
      if (!re.test(name)) return { ok: false, reason: `missing required ${re}` };
    }
  }
  if (rules.anyOf?.length) {
    const hit = rules.anyOf.some((re) => re.test(name));
    if (!hit) return { ok: false, reason: 'no pattern in anyOf matched' };
  }
  return { ok: true, reason: '' };
}

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const hasCourtColRes = await client.query(`
  SELECT 1 AS ok
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'cameras'
    AND column_name = 'court_number'
  LIMIT 1
`);
const hasCourtNumberColumn = hasCourtColRes.rowCount > 0;

const flatSql = `
  SELECT
    t.id AS turf_id,
    t.name AS turf_name,
    t.city,
    t.is_active,
    c.id AS camera_id,
    c.name AS camera_name,
    ${hasCourtNumberColumn ? 'c."court_number"' : 'NULL::integer'} AS court_number
  FROM turfs t
  LEFT JOIN cameras c ON c."turfId" = t.id
  ORDER BY t.name NULLS LAST, t.id::text,
    ${hasCourtNumberColumn ? 'c."court_number" NULLS LAST, ' : ''}c.id::text
`;

const flat = await client.query(flatSql);

const byTurf = new Map();
for (const row of flat.rows) {
  if (!byTurf.has(row.turf_id)) {
    byTurf.set(row.turf_id, {
      turf_id: row.turf_id,
      turf_name: row.turf_name,
      city: row.city,
      is_active: row.is_active,
      cameras: [],
    });
  }
  if (row.camera_id) {
    byTurf.get(row.turf_id).cameras.push({
      camera_id: row.camera_id,
      camera_name: row.camera_name,
      court_number: row.court_number,
    });
  }
}

const cameraToTurfSql = `
  SELECT c.id AS camera_id, c.name AS camera_name,
         ${hasCourtNumberColumn ? 'c."court_number"' : 'NULL::integer'} AS court_number,
         c."turfId" AS turf_id, t.name AS turf_name
  FROM cameras c
  JOIN turfs t ON t.id = c."turfId"
`;

const cameraToTurf = await client.query(cameraToTurfSql);

const sheetIdToRow = Object.fromEntries(cameraToTurf.rows.map((r) => [r.camera_id, r]));

const uuidAudit = [];
for (const exp of SPREADSHEET_CAMERAS) {
  const row = sheetIdToRow[exp.id];
  if (!row) {
    uuidAudit.push({
      camera_id: exp.id,
      status: 'MISSING_IN_DB',
      expected_court: exp.court,
      sheet_note: exp.note,
    });
    continue;
  }
  const nameCheck = matchTurfName(row.turf_name, exp.turfMatch);
  const courtNum = row.court_number;
  const issues = [];
  if (!nameCheck.ok) issues.push(`turf_name_mismatch: ${nameCheck.reason}`);
  if (hasCourtNumberColumn) {
    const courtOk = courtNum === exp.court || courtNum == null;
    if (!courtOk) issues.push(`court_number DB=${courtNum} expected=${exp.court}`);
  }

  uuidAudit.push({
    camera_id: exp.id,
    status: issues.length ? 'DISCREPANCY' : 'OK',
    turf_id: row.turf_id,
    turf_name: row.turf_name,
    db_court_number: courtNum,
    expected_court: exp.court,
    sheet_note: exp.note,
    issues,
  });
}

/** Cameras in DB whose UUID is not on the ops sheet (informational). */
const notOnSheet = cameraToTurf.rows.filter((r) => !SHEET_IDS.has(r.camera_id));

/**
 * Names shared by multiple `turfs.id` rows (staging dupes confuse Find / QR if split).
 * @param {Array<{ turf_id: string; turf_name: string }>} turfs
 */
function duplicateTurfNameClusters(turfs) {
  const buckets = new Map();
  for (const t of turfs) {
    const nk = String(t.turf_name ?? '').trim().toLowerCase();
    if (!nk) continue;
    if (!buckets.has(nk))
      buckets.set(nk, { displayName: String(t.turf_name ?? '').trim(), ids: [] });
    buckets.get(nk).ids.push(t.turf_id);
  }
  const out = [];
  for (const { displayName, ids } of buckets.values()) {
    const uniq = [...new Set(ids)];
    if (uniq.length > 1)
      out.push({
        turf_name: displayName,
        turf_id_count: uniq.length,
        turf_ids: uniq,
      });
  }
  return out.sort((a, b) => b.turf_id_count - a.turf_id_count);
}

const summary = {
  turf_count: byTurf.size,
  camera_count_in_db: cameraToTurf.rows.length,
  sheet_camera_count: SPREADSHEET_CAMERAS.length,
  sheet_uuid_missing_in_db: uuidAudit.filter((x) => x.status === 'MISSING_IN_DB').length,
  sheet_uuid_discrepancy: uuidAudit.filter((x) => x.status === 'DISCREPANCY').length,
  sheet_uuid_ok: uuidAudit.filter((x) => x.status === 'OK').length,
  db_cameras_not_on_sheet: notOnSheet.length,
  cameras_court_number_column_present: hasCourtNumberColumn,
  duplicate_turf_name_clusters: duplicateTurfNameClusters([...byTurf.values()]),
  hint: hasCourtNumberColumn
    ? null
    : 'DB has no cameras.court_number column yet; run `npm run migration:run`. Turf-name vs sheet hints still checked; DB court_number vs sheet skipped until then.',
};

const output = {
  summary,
  turfs_with_cameras: [...byTurf.values()].map((t) => ({
    ...t,
    camera_count: t.cameras.length,
  })),
  spreadsheet_uuid_audit: uuidAudit,
  db_cameras_not_listed_on_spreadsheet: notOnSheet.map((r) => ({
    camera_id: r.camera_id,
    camera_name: r.camera_name,
    court_number: r.court_number,
    turf_id: r.turf_id,
    turf_name: r.turf_name,
  })),
};

if (ARG_JSON) {
  console.log(JSON.stringify(output, null, 2));
}

if (ARG_PRETTY) {
  if (!hasCourtNumberColumn) {
    console.log(
      '\n[note] cameras.court_number column missing — run `npm run migration:run`. Turf↔name checks still run; only DB court_number vs spreadsheet is skipped.\n',
    );
  }
  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  if (summary.duplicate_turf_name_clusters.length) {
    console.log('\n=== Duplicate turf names (multiple UUIDs) ===');
    for (const c of summary.duplicate_turf_name_clusters)
      console.log(`  "${c.turf_name}" → ${c.turf_id_count} rows: ${c.turf_ids.join(', ')}`);
  }

  console.log('\n=== Turf → cameras (readable) ===');
  for (const t of [...byTurf.values()].sort((a, b) =>
    String(a.turf_name ?? '').localeCompare(String(b.turf_name ?? '')),
  )) {
    const line = `- ${t.turf_name} (${t.turf_id}) [active=${t.is_active}]`;
    console.log(line);
    if (!t.cameras.length) console.log('    (no cameras)');
    else
      for (const c of t.cameras)
        console.log(
          `    • ${c.camera_id} | court_number=${c.court_number ?? 'null'} | name=${JSON.stringify(c.camera_name)}`,
        );
  }

  console.log('\n=== Spreadsheet UUID audit ===');
  for (const x of uuidAudit) {
    if (x.status !== 'OK' || ARG_ALL_OK) {
      const tag = x.status === 'OK' ? '[√]' : '[!]';
      console.log(`${tag} ${x.status} ${x.camera_id}`, x.sheet_note ?? '', JSON.stringify(x));
    }
  }
  const okN = uuidAudit.filter((x) => x.status === 'OK').length;
  if (!ARG_ALL_OK && okN > 0) console.log(`(omit ${okN} OK rows); pass --all-ok to print them`);

  if (notOnSheet.length) {
    console.log('\n=== DB cameras not on spreadsheet list (FYI) ===');
    for (const r of notOnSheet)
      console.log(
        `  ${r.camera_id} → ${r.turf_name} | court_number=${r.court_number}`,
      );
  }
}

await client.end();
