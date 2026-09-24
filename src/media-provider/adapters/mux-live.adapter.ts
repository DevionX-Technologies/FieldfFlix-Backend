import { Injectable, Logger } from '@nestjs/common';
import {
  CreateLiveStreamInput,
  ILiveStreamProvider,
  LiveStreamOutput,
} from '../interfaces/live-stream-provider.interface';
import { LiveProviderType } from '../interfaces/media-feature-flags.interface';
import { MuxService } from '../../mux/mux.service';
import { MediaProviderError } from '../errors/media-provider.error';

@Injectable()
export class MuxLiveAdapter implements ILiveStreamProvider {
  private readonly logger = new Logger(MuxLiveAdapter.name);
  readonly providerName: LiveProviderType = 'mux';

  constructor(private readonly muxService: MuxService) {}

  async createLiveStream(
    input: CreateLiveStreamInput,
  ): Promise<LiveStreamOutput> {
    try {
      this.logger.log(
        `Creating Mux live stream for court ${input.courtNumber ?? 'unknown'}`,
      );
      const res = await this.muxService.createLiveStream();
      return {
        provider: 'mux',
        providerLiveStreamId: res.liveStreamId,
        rtmpUrl: res.rtmpUrl,
        playbackUrl: res.playbackUrl,
        streamKey: res.streamKey,
        status: 'ready',
        rawProviderResponse: res,
      };
    } catch (err: any) {
      this.logger.error(
        `Mux live stream creation failed: ${err.message}`,
        err.stack,
      );
      throw new MediaProviderError(
        err.message || 'Failed to create Mux live stream',
        'mux',
        'createLiveStream',
        false,
        err.status,
        err,
      );
    }
  }

  async getLiveStream(providerLiveStreamId: string): Promise<LiveStreamOutput> {
    try {
      // In Mux SDK, live streams can be retrieved via mux client
      const liveStream = await (
        this.muxService as any
      ).mux?.video?.liveStreams?.retrieve(providerLiveStreamId);
      const playbackId = liveStream?.playback_ids?.[0]?.id || '';
      return {
        provider: 'mux',
        providerLiveStreamId,
        rtmpUrl: `rtmp://global-live.mux.com:5222/app/${liveStream?.stream_key || ''}`,
        playbackUrl: playbackId
          ? `https://stream.mux.com/${playbackId}.m3u8`
          : '',
        streamKey: liveStream?.stream_key,
        status: liveStream?.status || 'unknown',
        rawProviderResponse: liveStream,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to retrieve Mux live stream ${providerLiveStreamId}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to get Mux live stream',
        'mux',
        'getLiveStream',
        false,
        err.status,
        err,
      );
    }
  }

  async stopLiveStream(
    providerLiveStreamId: string,
  ): Promise<{ success: boolean }> {
    try {
      this.logger.log(`Disabling Mux live stream ${providerLiveStreamId}`);
      await this.muxService.disableLiveStream(providerLiveStreamId);
      return { success: true };
    } catch (err: any) {
      this.logger.error(
        `Failed to stop Mux live stream ${providerLiveStreamId}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to stop Mux live stream',
        'mux',
        'stopLiveStream',
        false,
        err.status,
        err,
      );
    }
  }

  async deleteLiveStream(
    providerLiveStreamId: string,
  ): Promise<{ success: boolean }> {
    return this.stopLiveStream(providerLiveStreamId);
  }
}
