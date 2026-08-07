require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { randomUUID } = require('crypto');

async function generateTestPayload() {
  const region = process.env.AWS_REGION || 'ap-south-1';
  const bucketName =
    process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-production-media';

  const s3 = new S3Client({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });

  const testRecordingId = randomUUID();
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.]/g, '')
    .slice(0, 14);
  const s3Key = `recordings/test_${testRecordingId}_${timestamp}.mp4`;

  // Pre-signed URL valid for 4 hours (14400 seconds)
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
    ContentType: 'video/mp4',
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 14400 });

  // Calculate past 5-minute time window for testing
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);

  const testPayload = {
    recordingId: testRecordingId,
    channel: 1, // Court 1 / Channel 1
    startTime: tenMinAgo.toISOString(),
    endTime: fiveMinAgo.toISOString(),
    uploadUrl: uploadUrl,
    s3Key: s3Key,
  };

  console.log('\n================== GENERATED TEST PAYLOAD ==================');
  console.log(JSON.stringify(testPayload, null, 2));
  console.log('============================================================\n');
  console.log(`Target S3 Bucket: s3://${bucketName}/${s3Key}`);
  console.log(`URL Expiration: 4 Hours (14400 seconds)`);
}

generateTestPayload();
