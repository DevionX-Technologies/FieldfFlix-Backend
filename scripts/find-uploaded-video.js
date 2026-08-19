require('dotenv').config();
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const region = process.env.AWS_REGION || 'ap-south-1';
const bucket = process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-production-media';

const s3 = new S3Client({
  region,
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

async function findUploadedFile() {
  console.log(`Searching across all keys in bucket: ${bucket}...`);

  let continuationToken = undefined;
  let allObjects = [];

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    if (res.Contents) {
      allObjects.push(...res.Contents);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  console.log(`Total objects in bucket: ${allObjects.length}`);

  // Sort by LastModified descending
  allObjects.sort((a, b) => b.LastModified - a.LastModified);

  console.log(`\n=== 15 MOST RECENT OBJECTS IN S3 ===`);
  for (const obj of allObjects.slice(0, 15)) {
    const sizeMb = (obj.Size / (1024 * 1024)).toFixed(2);
    console.log(
      `Key: ${obj.Key} | Size: ${sizeMb} MB | LastModified: ${obj.LastModified.toISOString()}`,
    );
  }

  console.log(`\n=== OBJECTS AROUND ~200-250 MB ===`);
  const sizedObjects = allObjects.filter(
    (obj) => obj.Size > 150 * 1024 * 1024 && obj.Size < 350 * 1024 * 1024,
  );
  for (const obj of sizedObjects.slice(0, 10)) {
    const sizeMb = (obj.Size / (1024 * 1024)).toFixed(2);
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: obj.Key });
    const url = await getSignedUrl(s3, getCommand, { expiresIn: 86400 });
    console.log(`\nKey: ${obj.Key}`);
    console.log(
      `Size: ${sizeMb} MB | LastModified: ${obj.LastModified.toISOString()}`,
    );
    console.log(`▶ Playable URL: ${url}`);
  }
}

findUploadedFile();
