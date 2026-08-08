import * as dotenv from 'dotenv';
import * as path from 'path';
import axios from 'axios';
import Mux from '@mux/mux-node';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const LIVE_URL = 'https://raspberrypi-court11.taild82368.ts.net:8443';
const LIVE_KEY =
  '9d6bdf976525e1641b6162ebd6c5d13ff9ee13345e7d6cfcd702b18293ebadfd';

const REC_URL = 'https://raspberrypi-court11.taild82368.ts.net';
const REC_KEY =
  'b0967580ef4fe425b2336c25b0a9d19d06a9f3800a422ecd5785ddfd261172a6';

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

async function runLiveStreamTest() {
  console.log('\n======================================================');
  console.log('--- 1. STARTING LIVE STREAM TEST VIA MUX & PI GATEWAY ---');
  console.log('======================================================');

  console.log('Creating Mux test live stream...');
  const muxLive = await mux.video.liveStreams.create({
    playback_policy: ['public'],
    new_asset_settings: { playback_policy: ['public'] },
    reduced_latency: true,
  });

  const liveStreamId = muxLive.id;
  const streamKey = muxLive.stream_key;
  const playbackId = muxLive.playback_ids?.[0]?.id;
  const rtmpUrl = `rtmps://global-live.mux.com:443/app/${streamKey}`;
  const playbackUrl = `https://stream.mux.com/${playbackId}.m3u8`;

  console.log(`Created Mux Live Stream: ${liveStreamId}`);
  console.log(`Playback URL: ${playbackUrl}`);

  try {
    console.log(`Calling Pi Live Gateway to start streaming Channel 1...`);
    const startRes = await axios.post(
      `${LIVE_URL}/start-live-stream`,
      { channel: 1, rtmpUrl },
      {
        headers: { 'X-API-KEY': LIVE_KEY, 'Content-Type': 'application/json' },
      },
    );
    console.log('Pi start response:', startRes.data);

    console.log('Waiting 14 seconds for transcode & ingest handshake...');
    await new Promise((r) => setTimeout(r, 14000));

    console.log('Checking Pi live stream status...');
    const statusRes = await axios.get(`${LIVE_URL}/live-stream-status`, {
      headers: { 'X-API-KEY': LIVE_KEY },
    });
    console.log('Pi Stream Status:', JSON.stringify(statusRes.data, null, 2));

    console.log(
      'Waiting another 8 seconds to probe Mux HLS playback playlist...',
    );
    await new Promise((r) => setTimeout(r, 8000));

    try {
      const hlsRes = await axios.get(playbackUrl, { timeout: 5000 });
      console.log(
        `Mux HLS Status: HTTP ${hlsRes.status} (Stream is actively playing!)`,
      );
      console.log(`HLS Playlist Snippet:\n`, hlsRes.data.slice(0, 200));
    } catch (hlsErr: any) {
      console.log(
        `Mux HLS check status: ${hlsErr.response?.status || hlsErr.message}`,
      );
    }
  } finally {
    console.log('Stopping live stream on Pi...');
    try {
      const stopRes = await axios.post(
        `${LIVE_URL}/stop-live-stream`,
        { channel: 1 },
        {
          headers: {
            'X-API-KEY': LIVE_KEY,
            'Content-Type': 'application/json',
          },
        },
      );
      console.log('Pi stop response:', stopRes.data);
    } catch (err: any) {
      console.error('Stop stream error:', err.response?.data || err.message);
    }

    console.log('Deleting test Mux live stream...');
    try {
      await mux.video.liveStreams.delete(liveStreamId);
      console.log('Mux test live stream deleted cleanly.');
    } catch {
      // Ignored
    }
  }
}

async function runExtractionTest() {
  console.log('\n======================================================');
  console.log('--- 2. STARTING MATCH EXTRACTION TEST (EVMS -> S3) ---');
  console.log('======================================================');

  const bucketName =
    process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-production-media';
  const recordingId = `test-extraction-${Date.now()}`;
  const s3Key = `recordings/${recordingId}.mp4`;

  // Window: 1 minute clip from 15 minutes ago to 14 minutes ago UTC
  const now = new Date();
  const endTime = new Date(now.getTime() - 14 * 60 * 1000);
  const startTime = new Date(now.getTime() - 15 * 60 * 1000);

  const startIso = startTime.toISOString();
  const endIso = endTime.toISOString();

  console.log(
    `Generating presigned PUT URL for s3://${bucketName}/${s3Key}...`,
  );
  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
    ContentType: 'video/mp4',
  });
  const presignedPutUrl = await getSignedUrl(s3Client, putCommand, {
    expiresIn: 14400,
  });

  console.log(`Calling Pi EVMS Gateway /extract-session:`);
  console.log(`  Recording ID: ${recordingId}`);
  console.log(`  Channel: 1`);
  console.log(`  Start: ${startIso}`);
  console.log(`  End:   ${endIso}`);

  const extractPayload = {
    recordingId,
    channel: 1,
    startTime: startIso,
    endTime: endIso,
    uploadUrl: presignedPutUrl,
    s3Key,
  };

  try {
    const extractRes = await axios.post(
      `${REC_URL}/extract-session`,
      extractPayload,
      {
        headers: {
          'X-API-KEY': REC_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 180000, // 3 minutes timeout for 1-minute clip extraction
      },
    );

    console.log(
      'EVMS Extraction Response:',
      JSON.stringify(extractRes.data, null, 2),
    );

    console.log('Verifying uploaded object on S3 via HeadObject...');
    const headRes = await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      }),
    );

    console.log('S3 Object Verified Successfully:');
    console.log(
      `  Content-Length: ${headRes.ContentLength} bytes (${((headRes.ContentLength || 0) / 1024 / 1024).toFixed(2)} MB)`,
    );
    console.log(`  Content-Type:   ${headRes.ContentType}`);
    console.log(`  ETag:           ${headRes.ETag}`);
    console.log(`  Last-Modified:  ${headRes.LastModified}`);
  } catch (error: any) {
    console.error(
      'Extraction Test Failed:',
      error.response?.data || error.message,
    );
  }
}

async function main() {
  await runLiveStreamTest();
  await runExtractionTest();
}

main().catch(console.error);
