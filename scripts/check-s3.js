const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');

process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const s3 = new S3Client({ region: process.env.AWS_REGION });

async function main() {
  const bucket = process.argv[2] || 'fieldflicks-production-media';
  const key = process.argv[3];

  if (!key) {
    console.error('Usage: node scripts/check-s3.js [bucketName] <objectKey>');
    process.exit(1);
  }

  console.log(`Checking s3://${bucket}/${key}...`);
  try {
    const res = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    console.log('\n--- Object Metadata ---');
    console.log(
      `Size: ${res.ContentLength} bytes (${(res.ContentLength / (1024 * 1024)).toFixed(2)} MB)`,
    );
    console.log(`Last Modified: ${res.LastModified.toLocaleString()}`);
    console.log(`Content Type: ${res.ContentType}`);
    console.log('Metadata:', res.Metadata);
  } catch (error) {
    console.error(`Error or object not found: ${error.message}`);
  }
}

main();
