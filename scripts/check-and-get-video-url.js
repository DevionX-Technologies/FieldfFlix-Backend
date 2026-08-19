require('dotenv').config();
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
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

async function checkRecentUploads() {
  console.log(`Checking S3 bucket '${bucket}' for recent recordings...`);

  try {
    const listRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'recordings/',
        MaxKeys: 50,
      }),
    );

    const items = listRes.Contents || [];
    // Sort by LastModified descending
    items.sort((a, b) => b.LastModified - a.LastModified);

    console.log(
      `Found ${items.length} objects under recordings/ (showing top 10 most recent):`,
    );

    for (const item of items.slice(0, 10)) {
      const sizeMb = (item.Size / (1024 * 1024)).toFixed(2);
      console.log(`\n- Key: ${item.Key}`);
      console.log(
        `  Size: ${sizeMb} MB | Last Modified: ${item.LastModified.toISOString()}`,
      );

      // Generate a signed GET URL valid for 24 hours
      const getCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: item.Key,
      });
      const playableUrl = await getSignedUrl(s3, getCommand, {
        expiresIn: 86400,
      });
      console.log(`  ▶ Playable URL: ${playableUrl}`);
    }
  } catch (err) {
    console.error('Error checking S3:', err.message);
  }
}

checkRecentUploads();
