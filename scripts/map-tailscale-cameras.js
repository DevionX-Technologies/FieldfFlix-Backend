const { Client } = require('pg');
const { execSync } = require('child_process');

async function main() {
  // 1. Get Tailscale status
  let tailscaleOutput = '';
  try {
    tailscaleOutput = execSync('/usr/local/bin/tailscale status', {
      encoding: 'utf8',
    });
  } catch (err) {
    console.error('Error running tailscale status:', err.message);
    return;
  }

  const lines = tailscaleOutput.split('\n');
  const piMappings = {};

  lines.forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) return;
    const ip = parts[0];
    const hostname = parts[1];
    const status = parts.slice(4).join(' ') || 'active';

    if (hostname.startsWith('raspberrypi-court') || hostname === 'juhu') {
      let camNum = null;
      if (hostname === 'juhu') {
        // Juhu host might map to Camera 1 or another specific camera; we can list it.
      } else {
        const match = hostname.match(/raspberrypi-court(\d+)/);
        if (match) {
          camNum = parseInt(match[1], 10);
        }
      }
      piMappings[hostname] = { ip, hostname, camNum, status };
    }
  });

  // 2. Connect to Database
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

    const mappedList = [];
    const unmappedPis = { ...piMappings };

    result.rows.forEach((r) => {
      let matchedPi = null;
      const nameMatch = r.name ? r.name.match(/Camera\s+(\d+)/i) : null;

      if (nameMatch) {
        const num = parseInt(nameMatch[1], 10);
        const hostKey = Object.keys(unmappedPis).find(
          (k) => unmappedPis[k].camNum === num,
        );
        if (hostKey) {
          matchedPi = unmappedPis[hostKey];
          delete unmappedPis[hostKey];
        }
      }

      mappedList.push({
        camera_id: r.id,
        camera_name: r.name,
        court: r.court_number,
        arena: r.turf_name,
        pinggy_url: r.raspberryPiBaseUrl || 'NULL',
        tailscale_ip: matchedPi ? matchedPi.ip : 'offline/not in tailnet',
        tailscale_host: matchedPi ? matchedPi.hostname : 'N/A',
        status: matchedPi ? matchedPi.status : 'offline',
      });
    });

    console.log('\n=== Mapped Tailscale Cameras ===');
    console.table(mappedList);

    const leftovers = Object.values(unmappedPis);
    if (leftovers.length > 0) {
      console.log('\n=== Unmapped Tailscale Devices ===');
      console.table(leftovers);
    }
  } catch (error) {
    console.error('Error mapping cameras:', error);
  } finally {
    await client.end();
  }
}

main();
