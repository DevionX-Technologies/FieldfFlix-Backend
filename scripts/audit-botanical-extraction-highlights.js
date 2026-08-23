#!/usr/bin/env node
/**
 * Production audit: Botanical Gardens courts 3–6 extraction sessions vs S3 vs linked highlights.
 * Uses prod API + S3 only — never Neon/local DB.
 *
 *   node scripts/audit-botanical-extraction-highlights.js
 *   node scripts/audit-botanical-extraction-highlights.js --dates=2026-08-21,2026-08-22,2026-08-23
 */

require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const API_BASE = process.env.PROD_API_URL || 'https://api.fieldflicks.com';
const BUCKET = process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-media-assets';
const REGION = process.env.AWS_S3_REGION || 'eu-north-1';
const BOTANICAL = 'botanical';
const COURTS = [3, 4, 5, 6];

const HIGHLIGHT_RE =
  /^highlights\/court(\d+)_cam(\d+)_(\d{8})-(\d{6})_highlight\.mp4$/;

// Botanical logical court → NVR cam channels (both angles)
const BOTANICAL_NVR = {
  3: [8, 9],
  4: [5, 11],
  5: [2, 3],
  6: [1, 10],
};

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function parseIstKey(datePart, timePart) {
  const y = datePart.slice(0, 4);
  const mo = datePart.slice(4, 6);
  const d = datePart.slice(6, 8);
  const h = timePart.slice(0, 2);
  const mi = timePart.slice(2, 4);
  const s = timePart.slice(4, 6);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`);
}

function fmtIst(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

async function fetchSessions(date) {
  const url = `${API_BASE}/admin/extraction-requests?date=${date}&limit=500`;
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`API ${date}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const data = body.data || body;
  return (data.requests || []).filter(
    (r) =>
      String(r.venueName || '')
        .toLowerCase()
        .includes(BOTANICAL) && COURTS.includes(Number(r.courtNumber)),
  );
}

async function loadAllS3Highlights() {
  const s3 = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const byKey = [];
  let token;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: 'highlights/',
        ContinuationToken: token,
      }),
    );
    for (const obj of resp.Contents || []) {
      const m = HIGHLIGHT_RE.exec(obj.Key || '');
      if (!m) continue;
      const court = parseInt(m[1], 10);
      if (!COURTS.includes(court)) continue;
      byKey.push({
        key: obj.Key,
        court,
        nvrCam: parseInt(m[2], 10),
        at: parseIstKey(m[3], m[4]),
        ymd: m[3],
      });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);

  return byKey;
}

function s3InWindow(allS3, court, startMs, endMs) {
  const cams = BOTANICAL_NVR[court] || [];
  return allS3.filter(
    (h) =>
      h.court === court &&
      cams.includes(h.nvrCam) &&
      h.at.getTime() >= startMs &&
      h.at.getTime() <= endMs,
  );
}

function istDateFromIso(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

async function main() {
  const dates = arg('dates', '2026-08-21,2026-08-22,2026-08-23').split(',');

  console.log('=== Botanical Gardens Courts 3–6 — Production Audit ===');
  console.log(`API: ${API_BASE}`);
  console.log(`S3:  s3://${BUCKET}/highlights/`);
  console.log(`Dates: ${dates.join(', ')}\n`);

  const allS3 = await loadAllS3Highlights();
  console.log(`Loaded ${allS3.length} S3 highlight keys for courts 3–6\n`);

  const summary = {
    sessions: 0,
    withVideo: 0,
    stuckExtracting: 0,
    adminLinked: 0,
    adminInWindow: 0,
    s3Actual: 0,
    gapLinkedVsS3: 0,
  };

  const rows = [];

  for (const date of dates) {
    const sessions = await fetchSessions(date);
    console.log(
      `--- ${date} IST: ${sessions.length} Botanical court 3–6 session(s) ---`,
    );

    for (const s of sessions) {
      const startMs = new Date(s.startTime).getTime();
      const endMs = new Date(s.endTime).getTime();
      const s3Hits = s3InWindow(allS3, s.courtNumber, startMs, endMs);
      const linked = Number(s.linkedHighlightCount ?? 0);
      const inWindow = Number(s.highlightsInWindow ?? 0);
      const gap = s3Hits.length - linked;

      const channels = s.channelDetails || [];
      const anyMux = channels.some((c) => c.hasMux);
      const anyS3 = channels.some((c) => c.hasS3);
      const allExtracting =
        channels.length > 0 && channels.every((c) => c.status === 'extracting');
      const sessionReady = ['ready', 'completed'].includes(
        String(s.status).toLowerCase(),
      );

      summary.sessions += 1;
      if (anyMux || anyS3 || s.hasMux || s.hasS3) summary.withVideo += 1;
      if (allExtracting && !anyMux && !anyS3) summary.stuckExtracting += 1;
      summary.adminLinked += linked;
      summary.adminInWindow += inWindow;
      summary.s3Actual += s3Hits.length;
      summary.gapLinkedVsS3 += Math.max(0, gap);

      rows.push({
        date,
        court: s.courtNumber,
        id: s.id.slice(0, 8),
        istStart: fmtIst(s.startTime),
        istEnd: fmtIst(s.endTime),
        status: s.status,
        channels: channels
          .map((c) => `${c.nvrChannel}:${c.status}${c.hasMux ? '+mux' : ''}`)
          .join(' '),
        linked,
        inWindow,
        s3Actual: s3Hits.length,
        gap,
        hasVideo: anyMux || anyS3,
        stuck: allExtracting && !anyMux && !anyS3,
        mismatchInWindow: inWindow !== linked && inWindow > 0,
      });

      const flag =
        gap > 0
          ? '⚠ LINK GAP'
          : s3Hits.length === 0 && linked === 0
            ? '○ no S3'
            : '✓';
      console.log(
        `  ${flag} Court ${s.courtNumber} ${s.id.slice(0, 8)} ${fmtIst(s.startTime)}–${fmtIst(s.endTime)} | linked=${linked} inWindow=${inWindow} s3=${s3Hits.length} | ${s.status} | ${channels.map((c) => `ch${c.nvrChannel}:${c.status}`).join(' ')}`,
      );
    }
    console.log('');
  }

  // S3 totals by court/date (IST filename date)
  console.log('--- S3 highlight files by court & IST filename date ---');
  for (const date of dates) {
    const ymd = date.replace(/-/g, '');
    console.log(`  ${date}:`);
    for (const court of COURTS) {
      const n = allS3.filter((h) => h.court === court && h.ymd === ymd).length;
      if (n > 0) console.log(`    Court ${court}: ${n} S3 files`);
    }
  }

  console.log('\n=== TOTALS (all sessions Aug 21–23, courts 3–6) ===');
  console.log(`  Extraction sessions:     ${summary.sessions}`);
  console.log(`  With video (Mux/S3):     ${summary.withVideo}`);
  console.log(`  Stuck extracting (no video): ${summary.stuckExtracting}`);
  console.log(`  Admin "linked" sum:      ${summary.adminLinked}`);
  console.log(`  Admin "inWindow" sum:    ${summary.adminInWindow}`);
  console.log(`  S3 actual in windows:    ${summary.s3Actual}`);
  console.log(`  Unlinked gap (s3-linked): ${summary.gapLinkedVsS3}`);

  const issues = [];
  if (summary.gapLinkedVsS3 > 0) {
    issues.push(
      'attachS3HighlightsInTimeWindow not linking all S3 clips to sessions (IST parse or window mismatch)',
    );
  }
  const inWindowMismatch = rows.filter((r) => r.mismatchInWindow);
  if (inWindowMismatch.length) {
    issues.push(
      `highlightsInWindow counts camera-wide rows (${inWindowMismatch.length} sessions where inWindow ≠ linked)`,
    );
  }
  if (summary.stuckExtracting > 0) {
    issues.push(
      `${summary.stuckExtracting} sessions stuck "extracting" with no Mux/S3 — admin may show "ready" at session level incorrectly`,
    );
  }

  console.log('\n=== LIKELY BACKEND FAILURES ===');
  issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`));

  const outPath = arg(
    'out',
    '/Users/aniruddh/Desktop/ff/botanical-audit-aug21-23.json',
  );
  require('fs').writeFileSync(
    outPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), summary, rows, issues },
      null,
      2,
    ),
  );
  console.log(`\nFull report: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
