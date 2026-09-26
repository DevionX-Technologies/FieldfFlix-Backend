import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  CreateLiveStreamInput,
  ILiveStreamProvider,
  LiveStreamOutput,
} from '../interfaces/live-stream-provider.interface';
import { LiveProviderType } from '../interfaces/media-feature-flags.interface';
import { MediaProviderError } from '../errors/media-provider.error';

@Injectable()
export class CloudflareStreamLiveAdapter implements ILiveStreamProvider {
  private readonly logger = new Logger(CloudflareStreamLiveAdapter.name);
  readonly providerName: LiveProviderType = 'cloudflare';

  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly customerSubdomain: string;
  private readonly httpClient: AxiosInstance;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() customHttpClient?: AxiosInstance,
  ) {
    this.accountId =
      this.getEnv('CLOUDFLARE_ACCOUNT_ID', '') ||
      this.getEnv('CLOUDFLARE_STREAM_ACCOUNT_ID', '') ||
      this.getEnv('CLOUDFLARE_R2_ACCOUNT_ID', '');

    this.apiToken =
      this.getEnv('CLOUDFLARE_STREAM_API_TOKEN', '') ||
      this.getEnv('CLOUDFLARE_API_TOKEN', '');
    this.customerSubdomain = this.getEnv(
      'CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN',
      '',
    );

    if (!this.accountId || !this.apiToken) {
      this.logger.warn(
        'Cloudflare Stream credentials (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_STREAM_API_TOKEN) not fully configured.',
      );
    }

    if (customHttpClient) {
      this.httpClient = customHttpClient;
    } else {
      this.httpClient = axios.create({
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream`,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
    }
  }

  private getEnv(key: string, defaultValue: string): string {
    if (this.configService) {
      return (
        this.configService.get<string>(key) ?? process.env[key] ?? defaultValue
      );
    }
    return process.env[key] ?? defaultValue;
  }

  private buildPlaybackUrl(uid: string): string {
    if (this.customerSubdomain) {
      const host = this.customerSubdomain
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '');
      return `https://${host}/${uid}/manifest/video.m3u8`;
    }
    return `https://videodelivery.net/${uid}/manifest/video.m3u8`;
  }

  private mapCloudflareStatus(cfStatus?: string): string {
    switch (cfStatus?.toLowerCase()) {
      case 'connected':
        return 'live';
      case 'reconnecting':
        return 'reconnecting';
      case 'disconnected':
      case 'ready':
      case 'new':
        return 'ready';
      default:
        return cfStatus || 'ready';
    }
  }

  async createLiveStream(
    input: CreateLiveStreamInput,
  ): Promise<LiveStreamOutput> {
    try {
      this.logger.log(
        `Creating Cloudflare live input for court ${input.courtNumber ?? 'default'} (tournament: ${input.tournamentId ?? 'none'})`,
      );

      const payload = {
        meta: {
          name: input.name || `Court ${input.courtNumber || 'Stream'}`,
          courtNumber: input.courtNumber,
          tournamentId: input.tournamentId,
          turfId: input.turfId,
          ...input.metadata,
        },
        recording: {
          mode: 'automatic',
          timeoutSeconds: 300,
          requireSignedURLs: false,
        },
      };

      const response = await this.httpClient.post('/live_inputs', payload);
      const result = response.data?.result;

      if (!result?.uid) {
        throw new Error('Cloudflare Stream response missing live input UID');
      }

      const streamKey = result.rtmps?.streamKey || '';
      const rtmpsBase =
        result.rtmps?.url || 'rtmps://live.cloudflare.com:443/live/';
      const rtmpUrl = rtmpsBase.endsWith('/')
        ? `${rtmpsBase}${streamKey}`
        : `${rtmpsBase}/${streamKey}`;
      const playbackUrl = this.buildPlaybackUrl(result.uid);

      return {
        provider: 'cloudflare',
        providerLiveStreamId: result.uid,
        rtmpUrl,
        playbackUrl,
        streamKey,
        status: this.mapCloudflareStatus(result.status),
        rawProviderResponse: result,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to create Cloudflare live input: ${err.message}`,
        err.stack,
      );
      throw new MediaProviderError(
        err.message || 'Failed to create Cloudflare live input',
        'cloudflare',
        'createLiveStream',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
        err,
      );
    }
  }

  async getLiveStream(providerLiveStreamId: string): Promise<LiveStreamOutput> {
    try {
      const response = await this.httpClient.get(
        `/live_inputs/${providerLiveStreamId}`,
      );
      const result = response.data?.result;

      if (!result) {
        throw new Error('Live input details not returned');
      }

      const streamKey = result.rtmps?.streamKey || '';
      const rtmpsBase =
        result.rtmps?.url || 'rtmps://live.cloudflare.com:443/live/';
      const rtmpUrl = rtmpsBase.endsWith('/')
        ? `${rtmpsBase}${streamKey}`
        : `${rtmpsBase}/${streamKey}`;

      return {
        provider: 'cloudflare',
        providerLiveStreamId: result.uid,
        rtmpUrl,
        playbackUrl: this.buildPlaybackUrl(result.uid),
        streamKey,
        status: this.mapCloudflareStatus(result.status),
        rawProviderResponse: result,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to retrieve Cloudflare live input ${providerLiveStreamId}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to retrieve Cloudflare live input',
        'cloudflare',
        'getLiveStream',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
        err,
      );
    }
  }

  async stopLiveStream(
    providerLiveStreamId: string,
  ): Promise<{ success: boolean }> {
    try {
      this.logger.log(`Deleting Cloudflare live input ${providerLiveStreamId}`);
      await this.httpClient.delete(`/live_inputs/${providerLiveStreamId}`);
      return { success: true };
    } catch (err: any) {
      this.logger.error(
        `Failed to stop/delete Cloudflare live input ${providerLiveStreamId}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to stop Cloudflare live input',
        'cloudflare',
        'stopLiveStream',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
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
