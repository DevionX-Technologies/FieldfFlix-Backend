const {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const cw = new CloudWatchLogsClient({ region: process.env.AWS_REGION });
const logGroup =
  process.env.AWS_CW_LOG_GROUP || '/ecs/devionx-fieldflix-backend';

async function runQuery() {
  const now = Math.floor(Date.now() / 1000);
  const startSec = now - 7 * 24 * 3600; // Search past 7 days

  const queryString = `
    fields @timestamp, @message
    | filter @message like /bbyastloun/ or @message like /apslbwsatm/ or @message like /26c1558e/ or @message like /27ce1af1/
    | limit 500
  `;

  console.log(`Querying CloudWatch Insights for Santacruz West camera logs...`);
  const out = await cw.send(
    new StartQueryCommand({
      logGroupName: logGroup,
      startTime: startSec,
      endTime: now,
      queryString,
      limit: 500,
    }),
  );

  const queryId = out.queryId;

  let result;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    result = await cw.send(new GetQueryResultsCommand({ queryId }));
    if (
      result.status === 'Complete' ||
      result.status === 'Failed' ||
      result.status === 'Cancelled'
    ) {
      break;
    }
  }

  if (result.status === 'Complete') {
    const rows = result.results || [];
    console.log(`Found ${rows.length} log lines.`);

    const ipRegex = /\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
    const generalIpRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

    const matchedIps = new Set();
    const matchedGeneralIps = new Set();

    rows.forEach((row) => {
      const msg = row.find((c) => c.field === '@message')?.value || '';

      const tailscaleMatches = msg.match(ipRegex);
      if (tailscaleMatches) {
        tailscaleMatches.forEach((ip) => matchedIps.add(ip));
      }

      const generalMatches = msg.match(generalIpRegex);
      if (generalMatches) {
        generalMatches.forEach((ip) => {
          if (
            !ip.startsWith('127.') &&
            !ip.startsWith('8.8.') &&
            !ip.startsWith('1.1.')
          ) {
            matchedGeneralIps.add(ip);
          }
        });
      }
    });

    console.log('\n--- Detected Tailscale IPs (100.x.x.x) ---');
    if (matchedIps.size > 0) {
      matchedIps.forEach((ip) => console.log(ip));
    } else {
      console.log('None found in the scanned log messages.');
    }

    console.log('\n--- Other Detected IPs ---');
    if (matchedGeneralIps.size > 0) {
      matchedGeneralIps.forEach((ip) => console.log(ip));
    } else {
      console.log('None found.');
    }
  } else {
    console.log(`Query failed: ${result.status}`);
  }
}

runQuery().catch(console.error);
