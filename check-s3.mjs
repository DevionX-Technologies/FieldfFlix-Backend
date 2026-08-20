import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config();

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function main() {
  const prefix = 'highlights/court1_cam';
  console.log(
    `Checking bucket fieldflicks-production-media for prefix ${prefix}...`,
  );
  try {
    const data = await s3.send(
      new ListObjectsV2Command({
        Bucket: 'fieldflicks-production-media',
        Prefix: prefix,
      }),
    );

    if (data.Contents && data.Contents.length > 0) {
      const matches = data.Contents.filter((item) =>
        item.Key.includes('20260812-130922'),
      ).map(
        (item) => `${item.Key} (${(item.Size / 1024 / 1024).toFixed(2)} MB)`,
      );

      if (matches.length > 0) {
        console.log('Found the following matches:');
        matches.forEach((m) => console.log(m));
      } else {
        console.log("No files containing '20260812-130922' were found.");
      }
    } else {
      console.log('No objects found with prefix.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
