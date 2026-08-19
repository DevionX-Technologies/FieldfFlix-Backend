require('dotenv').config();
const Mux = require('@mux/mux-node');

const tokenId = process.env.MUX_TOKEN_ID;
const tokenSecret = process.env.MUX_TOKEN_SECRET;

if (!tokenId || !tokenSecret) {
  console.error('Missing MUX_TOKEN_ID or MUX_TOKEN_SECRET in .env');
  process.exit(1);
}

const mux = new Mux({ tokenId, tokenSecret });

async function createTestLiveStream() {
  try {
    console.log('🎬 Creating active Mux Live Stream for Pi testing...');
    const liveStream = await mux.video.liveStreams.create({
      playback_policy: ['public'],
      new_asset_settings: {
        playback_policy: ['public'],
      },
      reduced_latency: true,
    });

    const streamKey = liveStream.stream_key;
    const playbackId = liveStream.playback_ids?.[0]?.id || '';
    const rtmpUrl = `rtmps://global-live.mux.com:443/app/${streamKey}`;
    const hlsUrl = `https://stream.mux.com/${playbackId}.m3u8`;
    const webPlayerUrl = `https://player.mux.com/${playbackId}`;

    const piPayload = {
      channel: 1,
      rtmpUrl: rtmpUrl,
    };

    console.log('\n======================================================');
    console.log('🎉 ACTIVE MUX LIVE STREAM CREATED SUCCESSFULLY');
    console.log('======================================================');
    console.log('Stream ID:     ', liveStream.id);
    console.log('Stream Key:    ', streamKey);
    console.log('Playback ID:   ', playbackId);
    console.log('------------------------------------------------------');
    console.log('\n📦 PI PAYLOAD (Send this to the Pi Developer):\n');
    console.log(JSON.stringify(piPayload, null, 2));
    console.log('\n------------------------------------------------------');
    console.log('📺 WATCH LIVE FEED IN BROWSER (Once Pi starts streaming):');
    console.log('HLS Stream URL:', hlsUrl);
    console.log('Web Player:    ', `https://stream.mux.com/${playbackId}`);
    console.log('======================================================\n');
  } catch (error) {
    console.error('Error creating Mux Live Stream:', error);
  }
}

createTestLiveStream();
