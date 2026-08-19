#!/usr/bin/env node
/**
 * cameras-url-audit.js  -  Read-only audit of the cameras.raspberryPiBaseUrl
 * column to detect URL rotation / mis-mapping issues.
 *
 * What it prints
 * --------------
 *
 *   1. Every camera with its venue, court_number, and current raspberryPiBaseUrl
 *      sorted by venue then court. This is the source of truth the backend
 *      uses when starting/stopping recordings.
 *
 *   2. Duplicate-URL groups: cameras that share the same raspberryPiBaseUrl.
 *      This usually means a Pinggy URL rotation was applied incompletely, or
 *      multiple cameras were configured to point at one Pi by mistake.
 *
 *   3. Cameras with NULL or empty raspberryPiBaseUrl: any /start call against
 *      these will fail because the backend has nowhere to send the request.
 *
 *   4. Suspicious URLs: ones that don't match the Pinggy pattern
 *      (e.g. expired tunnels, IP addresses, localhost).
 *
 * Usage
 * -----
 *
 *   node -r dotenv/config scripts/cameras-url-audit.js
 *
 * Same DB_* env vars as the other audit scripts. SSL is on by default for RDS.
 */
'use strict';

const { Client } = require('pg');

const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `[cameras-url-audit] Missing env vars: ${missing.join(', ')}\n` +
      'Run with `node -r dotenv/config scripts/cameras-url-audit.js` if you have a .env file.',
  );
  process.exit(2);
}

const sslOn = process.env.DB_SSL !== 'false';
const client = new Client({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: sslOn ? { rejectUnauthorized: false } : undefined,
});

const ANSI = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const pad = (s, n) => {
  const str = String(s ?? '');
  return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length);
};
const rule = (w = 130) => console.log(ANSI.dim('-'.repeat(w)));

(async () => {
  await client.connect();
  try {
    // -------- 1) Full per-camera dump ---------------------------------------
    const { rows: cameras } = await client.query(`
      SELECT c.id              AS camera_id,
             c.name            AS camera_name,
             COALESCE(c.court_number::text, '-') AS court,
             t.name            AS venue,
             c."raspberryPiBaseUrl" AS pi_url
        FROM cameras c
   LEFT JOIN turfs   t ON t.id = c."turfId"
    ORDER BY COALESCE(t.name,'~'), c.court_number NULLS LAST, c.name;
    `);

    console.log('');
    console.log(
      ANSI.bold(
        'CAMERAS  ·  current backend view of which URL each camera maps to',
      ),
    );
    rule();
    console.log(
      pad('Venue', 32) +
        pad('Court', 7) +
        pad('Camera', 22) +
        pad('Pi URL (raspberryPiBaseUrl)', 65) +
        'CameraId (short)',
    );
    rule();
    cameras.forEach((c) => {
      const url = c.pi_url || ANSI.red('NULL');
      console.log(
        pad(c.venue || '(no venue)', 32) +
          pad(c.court, 7) +
          pad(c.camera_name || '(no name)', 22) +
          pad(url, 65) +
          ANSI.dim(String(c.camera_id).slice(0, 8)),
      );
    });
    rule();
    console.log(`Total cameras: ${cameras.length}`);

    // -------- 2) Duplicate URLs --------------------------------------------
    const dupes = {};
    cameras.forEach((c) => {
      const u = (c.pi_url || '').trim();
      if (!u) return;
      (dupes[u] = dupes[u] || []).push(c);
    });
    const dupeGroups = Object.entries(dupes).filter(
      ([, arr]) => arr.length > 1,
    );

    console.log('');
    console.log(
      ANSI.bold(
        'DUPLICATE URL GROUPS  ·  multiple cameras pointing at the same Pi',
      ),
    );
    rule();
    if (dupeGroups.length === 0) {
      console.log(
        ANSI.green('OK - every camera has a unique raspberryPiBaseUrl.'),
      );
    } else {
      dupeGroups.forEach(([url, arr]) => {
        console.log(ANSI.yellow(`URL: ${url}  (${arr.length} cameras)`));
        arr.forEach((c) => {
          console.log(
            `  ${pad(c.venue || '?', 30)} ${pad('court ' + c.court, 12)} ${pad(c.camera_name || '?', 22)} ${ANSI.dim(String(c.camera_id).slice(0, 8))}`,
          );
        });
      });
    }
    rule();

    // -------- 3) NULL / empty URLs -----------------------------------------
    const nulls = cameras.filter((c) => !c.pi_url || !c.pi_url.trim());
    console.log('');
    console.log(
      ANSI.bold('CAMERAS WITH NO PI URL  ·  /start will fail for these'),
    );
    rule();
    if (nulls.length === 0) {
      console.log(
        ANSI.green('OK - every camera has a raspberryPiBaseUrl set.'),
      );
    } else {
      nulls.forEach((c) => {
        console.log(
          ANSI.red('  ') +
            pad(c.venue || '?', 30) +
            pad('court ' + c.court, 12) +
            pad(c.camera_name || '?', 22) +
            ANSI.dim(String(c.camera_id).slice(0, 8)),
        );
      });
    }
    rule();

    // -------- 4) Suspicious URLs -------------------------------------------
    const suspicious = cameras.filter((c) => {
      const u = (c.pi_url || '').toLowerCase();
      if (!u) return false;
      // Heuristics: Pinggy URLs look like rnf-XXX.a.pinggy.link or share.pinggy.io
      // Anything else is suspicious.
      const pinggyOk = u.includes('pinggy.link') || u.includes('pinggy.io');
      const looksLikeIP = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}/.test(u);
      const localhost = u.includes('localhost') || u.includes('127.0.0.1');
      return !pinggyOk || looksLikeIP || localhost;
    });
    console.log('');
    console.log(
      ANSI.bold('SUSPICIOUS URLs  ·  not matching the expected Pinggy pattern'),
    );
    rule();
    if (suspicious.length === 0) {
      console.log(
        ANSI.green('OK - all URLs match the Pinggy hostname pattern.'),
      );
    } else {
      suspicious.forEach((c) => {
        console.log(
          ANSI.yellow('  ') +
            pad(c.venue || '?', 30) +
            pad('court ' + c.court, 12) +
            pad(c.camera_name || '?', 22) +
            ANSI.dim(c.pi_url),
        );
      });
    }
    rule();

    // -------- 5) Quick interpretation guide --------------------------------
    console.log('');
    console.log(ANSI.bold('How to read this'));
    rule();
    console.log(
      'If you see duplicate URL groups: a Pinggy rotation was applied to one\n' +
        'camera but not the others that used to point at the same Pi. The backend\n' +
        'will now send /start calls to the same physical Pi for multiple courts,\n' +
        'which is almost certainly wrong.\n',
    );
    console.log(
      'If you see NULL or suspicious URLs: those cameras cannot record at all.\n' +
        'Recording attempts against them will fail at the /start step.\n',
    );
    console.log(
      'If a camera at TSG Padel has a URL that resolves to a Pi at Goregaon,\n' +
        'the URL row was edited incorrectly during a Pi swap. Cross-reference the\n' +
        'physical inventory at each venue with what this table says.\n',
    );
    rule();
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error('audit failed:', err.message);
  process.exit(1);
});
