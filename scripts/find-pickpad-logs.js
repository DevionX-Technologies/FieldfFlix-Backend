require('dotenv').config();
const {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

async function checkCloudWatch() {
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
    | filter @message like /pheetomxwm/ or @message like /PickPad/
    | sort @timestamp desc
    | limit 100
  `;

  console.log(`Querying CloudWatch logs for pheetomxwm / PickPad...`);
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
    console.log(`Found ${rows.length} log lines:`);
    rows.forEach((row) => {
      const ts = row.find((c) => c.field === '@timestamp')?.value;
      const msg = row.find((c) => c.field === '@message')?.value;
      console.log(`[${ts}] ${msg}`);
    });
  } else {
    console.log('Query status:', result ? result.status : 'timeout');
  }
}

checkCloudWatch();
