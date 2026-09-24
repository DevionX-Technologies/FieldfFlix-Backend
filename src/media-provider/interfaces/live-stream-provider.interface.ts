import { LiveProviderType } from './media-feature-flags.interface';

export interface CreateLiveStreamInput {
  name?: string;
  courtNumber?: number;
  channel?: number;
  cameraId?: string;
  tournamentId?: string;
  turfId?: string;
  metadata?: Record<string, any>;
}

export interface LiveStreamOutput {
  provider: LiveProviderType;
  providerLiveStreamId: string;
  rtmpUrl: string;
  playbackUrl: string;
  streamKey?: string;
  status: string;
  rawProviderResponse?: any;
}

export interface ILiveStreamProvider {
  readonly providerName: LiveProviderType;
  createLiveStream(input: CreateLiveStreamInput): Promise<LiveStreamOutput>;
  getLiveStream(providerLiveStreamId: string): Promise<LiveStreamOutput>;
  stopLiveStream(providerLiveStreamId: string): Promise<{ success: boolean }>;
  deleteLiveStream?(
    providerLiveStreamId: string,
  ): Promise<{ success: boolean }>;
}
