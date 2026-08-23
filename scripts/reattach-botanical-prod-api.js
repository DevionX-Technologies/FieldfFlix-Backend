#!/usr/bin/env node
/**
 * Re-link S3 highlights for Botanical courts 3–6 via production admin API.
 * Uses prod API only — never local/Neon DB.
 *
 *   node scripts/reattach-botanical-prod-api.js --dry-run
 *   node scripts/reattach-botanical-prod-api.js --dates=2026-08-21,2026-08-22,2026-08-23
 *   node scripts/reattach-botanical-prod-api.js --min-gap=1
 */

require('dotenv').config();

const API_BASE = process.env.PROD_API_URL || 'https://api.fieldflicks.com';
const BOTANICAL = 'botanical';
const COURTS = [3, 4, 5, 6];

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
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

async function reattachRecording(recordingId) {
  const url = `${API_BASE}/admin/recordings/${recordingId}/reattach-highlights`;
  const res = await fetch(url, { method: 'POST' });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${text}`);
  }
  return body;
}

async function main() {
  const dates = arg('dates', '2026-08-21,2026-08-22,2026-08-23').split(',');
  const dryRun = hasFlag('--dry-run');
  const minGap = Number(arg('min-gap', '1'));

  console.log(`=== Botanical reattach (prod API) ===`);
  console.log(`API: ${API_BASE}`);
  console.log(`Dates: ${dates.join(', ')}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  let totalAttached = 0;
  let sessionsProcessed = 0;

  for (const date of dates) {
    const sessions = await fetchSessions(date);
    console.log(`--- ${date}: ${sessions.length} session(s) ---`);

    for (const s of sessions) {
      const linked = Number(s.linkedHighlightCount ?? 0);
      const recordingIds = Array.isArray(s.recordingIds)
        ? s.recordingIds
        : [s.id];
      const primaryId = recordingIds[0];

      if (!primaryId) continue;

      // Reattach primary channel recording (both NVR cams attach to this row after backend patch).
      if (dryRun) {
        console.log(
          `  [dry-run] Court ${s.courtNumber} ${primaryId.slice(0, 8)} linked=${linked} → POST reattach`,
        );
        sessionsProcessed += 1;
        continue;
      }

      try {
        const result = await reattachRecording(primaryId);
        const attached = Number(result.attached ?? 0);
        totalAttached += attached;
        sessionsProcessed += 1;
        if (attached > 0) {
          console.log(
            `  +${attached} Court ${s.courtNumber} ${primaryId.slice(0, 8)} (was linked=${linked})`,
          );
        }
      } catch (err) {
        console.error(
          `  ✗ Court ${s.courtNumber} ${primaryId.slice(0, 8)}: ${err.message}`,
        );
      }

      // Gentle throttle — prod API
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  console.log(
    `\nDone: ${sessionsProcessed} session(s) processed, ${totalAttached} highlight row(s) attached`,
  );
  if (dryRun) {
    console.log(
      'Re-run without --dry-run after deploying backend highlight fixes.',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
