require('dotenv').config();
const {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

async function checkAllVenues() {
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
  const startSec = now - 14 * 24 * 3600; // past 14 days

  const queryString = `
    fields @timestamp, @message
    | filter @message like /Calling Raspberry Pi/ or @message like /Recording started/ or @message like /Recording stopped/
    | sort @timestamp desc
    | limit 50
  `;

  console.log(`Querying CloudWatch logs for all venues...`);
  const out = await cw.send(
    new StartQueryCommand({
      logGroupName,
      startTime: startSec,
      endTime: now,
      queryString,
      limit: 50,
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
    console.log(`Found ${rows.length} log lines:`);
    const urls = new Set();
    rows.forEach((row) => {
      const ts = row.find((c) => c.field === '@timestamp')?.value;
      const msg = row.find((c) => c.field === '@message')?.value;
      console.log(`[${ts}] ${msg}`);
      const match = msg.match(/http[s]?:\/\/[^\s]+/);
      if (match) urls.add(match[0]);
    });
    console.log('\nUnique Pi URLs in logs:');
    urls.forEach((u) => console.log(u));
  }
}

checkAllVenues();
