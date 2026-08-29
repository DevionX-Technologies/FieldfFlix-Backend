require('dotenv').config();
const axios = require('axios');
const keysData = {
  1: {
    streamKey: '933e6812-bf32-1b00-c194-b4b4ab0beeb6',
    playbackId: 'xvJB2PhLjYVxxsSLrKhk00Qq3RlkQPv5xIs4C1kT02W8c',
  },
  2: {
    streamKey: 'a1f333d8-6887-7a46-7dab-d0f1f098ea6a',
    playbackId: 'GUKM8Z6DenMWbnYxy7twMJn1K759GwsLD7Io4QHhrFw',
  },
  3: {
    streamKey: '200cb985-b9ba-82cd-e83f-551aeae1a0be',
    playbackId: '4KjbtE011KXnqRKuKchBRBqwJZw5fnNxb007Vo3RFrTgY',
  },
  4: {
    streamKey: '4acc8649-f319-84f2-eac6-f2b7b0eec2b3',
    playbackId: 'ywdWRYRSqCpmioNRKQQ6Wbc200RPINl9hd7EUwWCW6YQ',
  },
  5: {
    streamKey: 'ce25973f-753e-7873-30d7-4311d5ab19bc',
    playbackId: '00kt00i9PHWFSLtcgAtydRawMvbrZm00302JlRBAOQSeqZI',
  },
  6: {
    streamKey: 'cae26409-1d1a-47bb-ff2e-0f5cd2d826f5',
    playbackId: 'Pp02gwVYjqh00RAzrwYlyaS8020200P502LykATt00qnkDScYw',
  },
};

async function getStreamIds() {
  const MUX_TOKEN_ID = process.env.MUX_TOKEN_ID;
  const MUX_TOKEN_SECRET = process.env.MUX_TOKEN_SECRET;
  const auth = Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString(
    'base64',
  );

  const targetKeys = Object.values(keysData).map((k) => k.streamKey);
  let allStreams = [];

  try {
    const response = await axios.get(
      'https://api.mux.com/video/v1/live-streams?limit=100',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      },
    );

    allStreams = response.data.data;
  } catch (e) {
    console.error('Failed to fetch streams', e.message);
    return;
  }

  for (const [channel, data] of Object.entries(keysData)) {
    const stream = allStreams.find((s) => s.stream_key === data.streamKey);
    const streamId = stream ? stream.id : 'UNKNOWN';

    console.log(
      `Camera ${channel} Stream ID: ${streamId} Stream Key: ${data.streamKey} Playback ID: ${data.playbackId} RTMP Ingest URL (For Pi): rtmps://global-live.mux.com:443/app/${data.streamKey} HLS Playback URL (For Frontend): https://stream.mux.com/${data.playbackId}.m3u8\n`,
    );
  }
}

getStreamIds();
