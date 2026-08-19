require('dotenv').config();
const Mux = require('@mux/mux-node');

const tokenId = process.env.MUX_TOKEN_ID;
const tokenSecret = process.env.MUX_TOKEN_SECRET;

const mux = new Mux({ tokenId, tokenSecret });

async function generate() {
  const channel = process.argv[2] ? parseInt(process.argv[2], 10) : 1;
  const liveStream = await mux.video.liveStreams.create({
    playback_policy: ['public'],
    new_asset_settings: { playback_policy: ['public'] },
    reduced_latency: true,
  });

  const streamKey = liveStream.stream_key;
  const playbackId = liveStream.playback_ids[0].id;
  const rtmpUrl = `rtmps://global-live.mux.com:443/app/${streamKey}`;

  const payload = {
    channel: channel,
    rtmpUrl: rtmpUrl,
  };

  console.log(JSON.stringify(payload, null, 2));
}

generate();
