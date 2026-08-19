const {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

process.env.AWS_REGION = 'ap-south-1';
const cw = new CloudWatchLogsClient({ region: 'ap-south-1' });
const logGroup = '/ecs/devionx-fieldflix-backend';

async function runQuery() {
  const now = Math.floor(Date.now() / 1000);
  const startSec = now - 3 * 24 * 3600; // past 3 days

  const queryString = `
    fields @timestamp, @message, @logStream
    | filter @message like /100.119.221.109/ or @message like /Botanical/ or @message like /court16/
    | sort @timestamp desc
    | limit 200
  `;

  console.log(`Querying CloudWatch Insights...`);
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
    console.log(`Found ${rows.length} log lines:`);
    rows.forEach((row, index) => {
      const ts = row.find((c) => c.field === '@timestamp')?.value;
      const msg = row.find((c) => c.field === '@message')?.value;
      console.log(`[${ts}] ${msg}`);
    });
  } else {
    console.log(`Query failed: ${result.status}`);
  }
}

runQuery().catch(console.error);
