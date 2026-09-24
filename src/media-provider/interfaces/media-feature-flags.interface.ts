export type StorageProviderType = 's3' | 'r2';
export type LiveProviderType = 'mux' | 'cloudflare';
export type VodProviderType = 'mux' | 'cloudflare';

export interface MediaContext {
  tournamentId?: string | null;
  turfId?: string | null;
  courtId?: string | null;
  recordingId?: string | null;
  assetId?: string | null;
}

export interface IMediaFeatureFlags {
  getStorageProvider(context?: MediaContext): StorageProviderType;
  getLiveProvider(context?: MediaContext): LiveProviderType;
  getVodProvider(context?: MediaContext): VodProviderType;
  isCloudflareLiveEnabled(context?: MediaContext): boolean;
  isCloudflareStorageEnabled(context?: MediaContext): boolean;
  isCloudflareVodEnabled(context?: MediaContext): boolean;
}
