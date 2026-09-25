import { ApiProperty } from '@nestjs/swagger';

export class CloudflareR2PlaybackDetails {
  @ApiProperty({
    description: 'Whether the raw MP4 in R2 is ready for progressive playback',
  })
  available: boolean;

  @ApiProperty({
    description:
      'Presigned progressive MP4 streaming/download URL from Cloudflare R2',
  })
  url: string | null;

  @ApiProperty({ description: 'R2 Object Key' })
  key: string | null;

  @ApiProperty({ description: 'R2 Bucket Name' })
  bucket: string | null;

  @ApiProperty({ description: 'ISO expiration time of the presigned URL' })
  expiresAt: string | null;
}

export class CloudflareStreamPlaybackDetails {
  @ApiProperty({
    description:
      'Whether Cloudflare Stream has completed multi-bitrate HLS transcoding',
  })
  available: boolean;

  @ApiProperty({ description: 'Cloudflare Stream Video UID' })
  videoUid: string | null;

  @ApiProperty({ description: 'Cloudflare Stream HLS manifest URL' })
  manifestUrl: string | null;

  @ApiProperty({
    description: 'Signed playback token if tokenization is required',
  })
  playbackToken: string | null;

  @ApiProperty({
    description: 'Stream processing status: ready, processing, or failed',
  })
  status: 'ready' | 'processing' | 'failed' | 'not_started';
}

export class CloudflarePlaybackResponseDto {
  @ApiProperty({ description: 'Recording UUID' })
  recordingId: string;

  @ApiProperty({
    description:
      'The primary, active video URL for the player. Points to R2 MP4 while Stream is processing, and automatically upgrades to Cloudflare Stream HLS when processing is complete.',
  })
  activeUrl: string;

  @ApiProperty({
    description: 'Current active streaming source',
    enum: ['CLOUDFLARE_STREAM', 'CLOUDFLARE_R2'],
  })
  activeProvider: 'CLOUDFLARE_STREAM' | 'CLOUDFLARE_R2';

  @ApiProperty({
    description: 'Overall media lifecycle state',
    enum: [
      'R2_READY',
      'STREAM_PROCESSING',
      'STREAM_READY',
      'UPLOADING',
      'FAILED',
    ],
  })
  status:
    | 'R2_READY'
    | 'STREAM_PROCESSING'
    | 'STREAM_READY'
    | 'UPLOADING'
    | 'FAILED';

  @ApiProperty({
    description: 'Details for Cloudflare R2 progressive MP4 playback',
  })
  r2: CloudflareR2PlaybackDetails;

  @ApiProperty({
    description: 'Details for Cloudflare Stream adaptive bitrate HLS',
  })
  stream: CloudflareStreamPlaybackDetails;

  @ApiProperty({ description: 'Video duration in seconds', required: false })
  durationSeconds?: number;
}
