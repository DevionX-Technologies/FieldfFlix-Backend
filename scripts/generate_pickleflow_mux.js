require('dotenv').config();
const axios = require('axios');

async function createStreams() {
  const MUX_TOKEN_ID = process.env.MUX_TOKEN_ID;
  const MUX_TOKEN_SECRET = process.env.MUX_TOKEN_SECRET;
  const auth = Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString(
    'base64',
  );

  const channels = [1, 2, 3, 4, 5, 6];
  const keys = {};

  for (const ch of channels) {
    try {
      const response = await axios.post(
        'https://api.mux.com/video/v1/live-streams',
        {
          playback_policy: ['public'],
          new_asset_settings: { playback_policy: ['public'] },
          reconnect_window: 60,
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const stream = response.data.data;
      const playbackId = stream.playback_ids[0].id;
      const streamKey = stream.stream_key;

      keys[ch] = {
        streamKey,
        playbackId,
      };

      console.log(
        `Channel ${ch} -> Key: ${streamKey}, Playback: ${playbackId}`,
      );
    } catch (e) {
      console.error(
        `Failed to create stream for ch ${ch}:`,
        e.response?.data || e.message,
      );
    }
  }

  console.log('\nResult:');
  console.log(JSON.stringify(keys, null, 2));
}

createStreams();
