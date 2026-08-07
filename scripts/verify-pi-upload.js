require('dotenv').config();
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');

async function checkUpload(s3Key) {
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

  const key =
    s3Key ||
    process.argv[2] ||
    'recordings/test_6ffe4ecb-036d-435b-a1d8-5fca4a1b0ece_20260807101106.mp4';
  console.log(`Checking S3 for key: s3://${bucketName}/${key}...`);

  try {
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );
    console.log('\n SUCCESS! File found in S3:');
    console.log(
      `- Content Length: ${(head.ContentLength / (1024 * 1024)).toFixed(2)} MB`,
    );
    console.log(`- Content Type: ${head.ContentType}`);
    console.log(`- Last Modified: ${head.LastModified}`);
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      console.log('⏳ File not yet uploaded in S3.');
    } else {
      console.error('Error checking S3:', e.message);
    }
  }
}

checkUpload();
