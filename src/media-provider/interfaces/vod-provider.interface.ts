import { VodProviderType } from './media-feature-flags.interface';

export interface VodDirectUploadInput {
  corsOrigin?: string;
  passthrough?: string;
  recordingId?: string;
  name?: string;
  metadata?: Record<string, any>;
  maxDurationSeconds?: number;
}

export interface VodDirectUploadOutput {
  provider: VodProviderType;
  uploadUrl: string;
  uploadId: string;
}

export interface VodCreateAssetInput {
  sourceUrl: string;
  name?: string;
  passthrough?: string;
  metadata?: Record<string, any>;
  watermarkUrl?: string;
}

export interface VodAssetOutput {
  provider: VodProviderType;
  assetId: string;
  playbackId?: string;
  playbackUrl?: string;
  status: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  rawProviderResponse?: any;
}

export interface VodCreateClipInput {
  parentAssetId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  passthrough?: string;
}

export interface VodClipOutput {
  provider: VodProviderType;
  clipAssetId: string;
  playbackId?: string;
  playbackUrl?: string;
  status: string;
  rawProviderResponse?: any;
}

export interface IVodProvider {
  readonly providerName: VodProviderType;
  createDirectUpload(
    input: VodDirectUploadInput,
  ): Promise<VodDirectUploadOutput>;
  createAssetFromUrl(input: VodCreateAssetInput): Promise<VodAssetOutput>;
  createClip(input: VodCreateClipInput): Promise<VodClipOutput>;
  getAsset(assetId: string): Promise<VodAssetOutput>;
  ingestFromUrl?(sourceUrl: string, options?: any): Promise<VodAssetOutput>;
}
