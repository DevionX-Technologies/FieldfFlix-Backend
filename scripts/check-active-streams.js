const {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const cwClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });

const logGroups = [
  '/aws/codebuild/FFmpegMuxer',
  '/aws/ecs/default/fieldflix-backend-5006-c00f',
  '/aws/lambda-insights',
  '/aws/lambda/MediaTrigger',
  '/aws/lambda/fieldflicks-dev-m3u8-converter',
  '/aws/lambda/fieldflicks-prod-mux-upload-video',
  '/aws/lambda/fieldflicks-production-m3u8-converter',
  '/aws/lambda/fieldflicks-production-mux-upload-video',
  '/aws/lambda/fieldflicks-production-retry-failed-highlights',
  '/aws/lambda/muxerFunction',
  '/aws/lambda/s3-audio-video-mux',
  '/aws/lambda/start-fargate-processor',
  '/ecs/devionx-fieldflix-backend',
];

async function checkGroup(groupName) {
  try {
    const command = new DescribeLogStreamsCommand({
      logGroupName: groupName,
      orderBy: 'LastEventTime',
      descending: true,
      limit: 1,
    });
    const response = await cwClient.send(command);
    if (response.logStreams && response.logStreams.length > 0) {
      const latest = response.logStreams[0];
      return {
        logGroupName: groupName,
        latestStream: latest.logStreamName,
        creationTime: new Date(latest.creationTime).toLocaleString(),
      };
    } else {
      return {
        logGroupName: groupName,
        latestStream: 'No streams',
        creationTime: 'N/A',
      };
    }
  } catch (error) {
    return {
      logGroupName: groupName,
      latestStream: 'Error: ' + error.message,
      creationTime: 'N/A',
    };
  }
}

async function main() {
  console.log('Fetching latest streams for all log groups...');
  const results = [];
  for (const group of logGroups) {
    const res = await checkGroup(group);
    results.push(res);
  }
  console.table(results);
}

main();
