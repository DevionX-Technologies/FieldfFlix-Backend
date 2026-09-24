export interface PlaybackGrant {
  assetId: string;
  playbackId: string;
  provider: 'cloudflare' | 'mux';
  playbackUrl: string;
  thumbnailUrl?: string;
  signedToken: string | null;
  expiresAt: Date;
  isPublic: boolean;
  hasPaidAccess: boolean;
  durationSeconds?: number;
}

export interface PlaybackAccessRequest {
  assetId: string;
  userId: string;
  isPublic?: boolean;
  ttlSeconds?: number;
  metadata?: Record<string, any>;
}

export interface IPlaybackAuthorizationService {
  getRecordingPlaybackGrant(
    recordingId: string,
    userId: string,
    ttlSeconds?: number,
  ): Promise<PlaybackGrant>;

  getHighlightPlaybackGrant(
    highlightId: string,
    userId: string,
    ttlSeconds?: number,
  ): Promise<PlaybackGrant>;
}
