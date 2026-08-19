const {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

process.env.AWS_REGION = 'ap-south-1';
const cw = new CloudWatchLogsClient({ region: 'ap-south-1' });

const logGroups = [
  '/ecs/devionx-fieldflix-backend',
  '/aws/ecs/default/fieldflix-backend-5006-c00f',
];

async function runQuery(logGroup) {
  const now = Math.floor(Date.now() / 1000);
  const startSec = now - 7 * 24 * 3600; // past 7 days

  const queryString = `
    fields @timestamp, @message, @logStream
    | filter @message like /(?i)cloudflare/ 
         or @message like /(?i)tunnel/ 
         or @message like /(?i)pinggy/ 
         or @message like /(?i)botanical/ 
         or @message like /100.119.221.109/
    | sort @timestamp desc
    | limit 200
  `;

  console.log(`Querying log group: ${logGroup}...`);
  try {
    const out = await cw.send(
      new StartQueryCommand({
        logGroupName: logGroup,
        startTime: startSec,
        endTime: now,
        queryString,
        limit: 200,
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
      console.log(`[${logGroup}] Found ${rows.length} log lines:`);
      rows.forEach((row, index) => {
        const ts = row.find((c) => c.field === '@timestamp')?.value;
        const msg = row.find((c) => c.field === '@message')?.value;
        console.log(`[${ts}] ${msg}`);
      });
    } else {
      console.log(`[${logGroup}] Query failed: ${result.status}`);
    }
  } catch (err) {
    console.error(`[${logGroup}] Error:`, err.message);
  }
}

async function main() {
  for (const group of logGroups) {
    await runQuery(group);
    console.log('----------------------------------------');
  }
}

main().catch(console.error);
