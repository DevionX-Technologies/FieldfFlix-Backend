require('dotenv').config();
const { Client } = require('pg');
const {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  DescribeLogGroupsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

async function checkDatabase() {
  console.log('=== Checking Database Cameras Table ===');
  const sslOn = process.env.DB_SSL !== 'false';
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: sslOn ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT c.id, c.name, c."raspberryPiBaseUrl", c.court_number, c."turfId", t.name as turf_name
      FROM cameras c
      LEFT JOIN turfs t ON c."turfId" = t.id
      ORDER BY c.name ASC
    `);
    console.log(`Found ${res.rows.length} cameras in DB:`);
    res.rows.forEach((r) => {
      console.log(
        `- [${r.turf_name || 'No Turf'}] Court ${r.court_number || r.name}: URL="${r.raspberryPiBaseUrl}"`,
      );
    });
  } catch (e) {
    console.error('DB Query Error:', e.message);
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkCloudWatch() {
  console.log('\n=== Checking CloudWatch Logs ===');
  const region = process.env.AWS_REGION || 'ap-south-1';
  const cw = new CloudWatchLogsClient({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });

  const logGroupName =
    process.env.AWS_CW_LOG_GROUP || '/ecs/devionx-fieldflix-backend';
  const now = Math.floor(Date.now() / 1000);
  const startSec = now - 7 * 24 * 3600; // past 7 days

  const queryString = `
    fields @timestamp, @message
    | filter @message like /Raspberry Pi/ or @message like /raspberryPiBaseUrl/ or @message like /pinggy/ or @message like /100./ or @message like /192.168/
    | sort @timestamp desc
    | limit 100
  `;

  try {
    console.log(`Querying CloudWatch group: ${logGroupName}...`);
    const out = await cw.send(
      new StartQueryCommand({
        logGroupName,
        startTime: startSec,
        endTime: now,
        queryString,
        limit: 100,
      }),
    );

    const queryId = out.queryId;
    let result;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      result = await cw.send(new GetQueryResultsCommand({ queryId }));
      if (
        result.status === 'Complete' ||
        result.status === 'Failed' ||
        result.status === 'Cancelled'
      ) {
        break;
      }
    }

    if (result && result.status === 'Complete') {
      const rows = result.results || [];
      console.log(
        `Found ${rows.length} CloudWatch log lines related to Raspberry Pi / IPs:`,
      );
      rows.slice(0, 30).forEach((row) => {
        const ts = row.find((c) => c.field === '@timestamp')?.value;
        const msg = row.find((c) => c.field === '@message')?.value;
        console.log(`[${ts}] ${msg}`);
      });
    } else {
      console.log('Query status:', result ? result.status : 'timeout');
    }
  } catch (e) {
    console.error('CloudWatch Query Error:', e.message);
  }
}

async function main() {
  await checkDatabase();
  await checkCloudWatch();
}

main();
