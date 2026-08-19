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

async function createMuxAsset() {
  const bucket =
    process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-production-media';
  const key =
    'recordings/test_cb243592-c4d0-4f9c-bb86-26ab21785942_20260807165916.mp4';

  console.log(`Generating S3 signed URL for Mux ingestion...`);
  const s3Url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 86400 },
  );

  console.log(`Creating Mux Video Asset...`);
  const asset = await mux.video.assets.create({
    input: [{ url: s3Url }],
    playback_policy: ['public'],
    video_quality: 'basic',
  });

  console.log(`\n=== MUX ASSET CREATED ===`);
  console.log(`Asset ID: ${asset.id}`);
  console.log(`Status: ${asset.status}`);

  if (asset.playback_ids && asset.playback_ids.length > 0) {
    const playbackId = asset.playback_ids[0].id;
    console.log(`\n▶ Direct Universal Mux Stream URL:`);
    console.log(`https://stream.mux.com/${playbackId}.m3u8`);
    console.log(`\n▶ Web Player Preview URL:`);
    console.log(`https://stream.new/v/${playbackId}`);
  }
}

createMuxAsset().catch(console.error);
