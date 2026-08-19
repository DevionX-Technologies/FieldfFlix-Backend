const {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');
const fs = require('fs');

process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const cw = new CloudWatchLogsClient({ region: process.env.AWS_REGION });
const logGroup =
  process.env.AWS_CW_LOG_GROUP || '/ecs/devionx-fieldflix-backend';

async function runQuery() {
  const recordingId = process.argv[2];
  const piId = process.argv[3];

  if (!recordingId) {
    console.error(
      'Usage: node scripts/find-recording-logs-insights.js <recordingId> [piId]',
    );
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const startSec = now - 3 * 24 * 3600; // Look back 3 days

  let filterExpr = `@message like /${recordingId}/`;
  if (piId) {
    filterExpr += ` or @message like /${piId}/`;
  }

  const queryString = `
    fields @timestamp, @message, @logStream
    | filter ${filterExpr}
    | sort @timestamp desc
    | limit 200
  `;

  console.log(`Querying CloudWatch Insights for log group: ${logGroup}...`);
  console.log(`Query: ${queryString}`);

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
    console.log(`Found ${rows.length} log lines.`);

    let fileContent = `Found ${rows.length} log lines for ${recordingId}:\n`;
    rows.forEach((row, index) => {
      const ts = row.find((c) => c.field === '@timestamp')?.value;
      const msg = row.find((c) => c.field === '@message')?.value;
      const stream = row.find((c) => c.field === '@logStream')?.value;
      fileContent += `\n--- Line ${index + 1} (${ts}) [${stream}] ---\n${msg}\n`;
    });

    fs.writeFileSync('recording-logs.txt', fileContent);
    console.log('Saved matches to recording-logs.txt');
  } else {
    console.log(`Query ended with status: ${result.status}`);
  }
}

runQuery().catch(console.error);
