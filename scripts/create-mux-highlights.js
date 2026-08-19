require('dotenv').config();
const Mux = require('@mux/mux-node');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

async function processKey(key) {
  const bucket =
    process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-production-media';

  console.log(`\nGenerating S3 signed URL for Mux ingestion: ${key}...`);
  const s3Url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 86400 },
  );

  console.log(`Creating Mux Video Asset for ${key}...`);
  const asset = await mux.video.assets.create({
    input: [{ url: s3Url }],
    playback_policy: ['public'],
    video_quality: 'basic',
  });

  console.log(`=== MUX ASSET CREATED ===`);
  console.log(`Asset ID: ${asset.id}`);
  console.log(`Status: ${asset.status}`);

  if (asset.playback_ids && asset.playback_ids.length > 0) {
    const playbackId = asset.playback_ids[0].id;
    console.log(`▶ Web Player Preview URL:`);
    console.log(`https://stream.new/v/${playbackId}`);
    return `https://stream.mux.com/${playbackId}.m3u8`;
  }
}

async function main() {
  const keys = [
    'highlights/court1_cam1_20260812-130922_highlight.mp4',
    'highlights/court1_cam2_20260812-130922_highlight.mp4',
  ];

  for (const key of keys) {
    try {
      await processKey(key);
    } catch (e) {
      console.error(`Failed to process ${key}:`, e.message);
    }
  }
}

main().catch(console.error);
