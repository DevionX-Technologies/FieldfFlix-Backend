import Mux from '@mux/mux-node';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

async function runBenchmark() {
  console.log('Starting Mux Benchmark...');
  
  // Use a sample public video URL
  const testVideoUrl = 'https://storage.googleapis.com/muxdemofiles/mux-video-intro.mp4';
  
  const startTime = Date.now();
  
  console.log(`[0s] Requesting Asset Creation from URL...`);
  
  const asset = await mux.video.assets.create({
    input: testVideoUrl,
    playback_policy: ['public'],
    mp4_support: 'none',
    encoding_tier: 'baseline',
  });
  
  console.log(`[${(Date.now() - startTime) / 1000}s] Asset created with ID: ${asset.id}. Status: ${asset.status}`);
  
  let isReady = false;
  
  // Poll for ready state
  while (!isReady) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const currentAsset = await mux.video.assets.retrieve(asset.id);
    
    console.log(`[${(Date.now() - startTime) / 1000}s] Asset status: ${currentAsset.status}`);
    
    if (currentAsset.status === 'ready') {
      isReady = true;
      console.log(`\n✅ Benchmark Complete!`);
      console.log(`Time to Playback (TTP): ${(Date.now() - startTime) / 1000} seconds`);
      console.log(`Playback URL: https://stream.mux.com/${currentAsset.playback_ids[0].id}.m3u8`);
    } else if (currentAsset.status === 'errored') {
      console.error('Asset creation failed.');
      break;
    }
  }
}

runBenchmark().catch(console.error);
