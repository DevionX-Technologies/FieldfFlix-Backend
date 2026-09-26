import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  IVodProvider,
  VodAssetOutput,
  VodClipOutput,
  VodCreateAssetInput,
  VodCreateClipInput,
  VodDirectUploadInput,
  VodDirectUploadOutput,
} from '../interfaces/vod-provider.interface';
import { VodProviderType } from '../interfaces/media-feature-flags.interface';
import { MediaProviderError } from '../errors/media-provider.error';

@Injectable()
export class CloudflareStreamVodAdapter implements IVodProvider {
  private readonly logger = new Logger(CloudflareStreamVodAdapter.name);
  readonly providerName: VodProviderType = 'cloudflare';

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
        timeout: 30000,
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

  private mapState(state?: string): string {
    switch (state?.toLowerCase()) {
      case 'ready':
        return 'ready';
      case 'error':
        return 'failed';
      case 'inprogress':
      case 'queued':
      case 'downloading':
        return 'preparing';
      default:
        return state || 'preparing';
    }
  }

  async createDirectUpload(
    input: VodDirectUploadInput,
  ): Promise<VodDirectUploadOutput> {
    try {
      this.logger.log('Creating Cloudflare direct upload URL');
      const payload: Record<string, any> = {
        maxDurationSeconds: input.maxDurationSeconds || 7200,
        requireSignedURLs: false,
        meta: {
          name:
            input.name ||
            input.passthrough ||
            input.recordingId ||
            'Match Recording',
          passthrough: input.passthrough || input.recordingId,
          ...input.metadata,
        },
      };

      if (input.corsOrigin) {
        payload.allowedOrigins = [input.corsOrigin];
      }

      const response = await this.httpClient.post('/direct_upload', payload);
      const result = response.data?.result;

      if (!result?.uploadURL || !result?.uid) {
        throw new Error('Cloudflare Stream response missing uploadURL or UID');
      }

      return {
        provider: 'cloudflare',
        uploadUrl: result.uploadURL,
        uploadId: result.uid,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to create Cloudflare direct upload: ${err.message}`,
        err.stack,
      );
      throw new MediaProviderError(
        err.message || 'Failed to create Cloudflare direct upload',
        'cloudflare',
        'createDirectUpload',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
        err,
      );
    }
  }

  async createAssetFromUrl(
    input: VodCreateAssetInput,
  ): Promise<VodAssetOutput> {
    try {
      this.logger.log(`Ingesting video into Cloudflare Stream from URL`);
      const payload: Record<string, any> = {
        url: input.sourceUrl,
        requireSignedURLs: false,
        meta: {
          name: input.name || input.passthrough || 'Match Recording',
          passthrough: input.passthrough,
          ...input.metadata,
        },
      };

      if (input.watermarkUrl) {
        payload.watermark = {
          url: input.watermarkUrl,
        };
      }

      const response = await this.httpClient.post('/copy', payload);
      const result = response.data?.result;

      if (!result?.uid) {
        throw new Error('Cloudflare Stream copy response missing UID');
      }

      const playbackUrl = this.buildPlaybackUrl(result.uid);

      return {
        provider: 'cloudflare',
        assetId: result.uid,
        playbackId: result.uid,
        playbackUrl,
        status: this.mapState(result.status?.state),
        durationSeconds: result.duration,
        rawProviderResponse: result,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to ingest video from URL to Cloudflare: ${err.message}`,
        err.stack,
      );
      throw new MediaProviderError(
        err.message || 'Failed to ingest video from URL to Cloudflare',
        'cloudflare',
        'createAssetFromUrl',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
        err,
      );
    }
  }

  async ingestFromUrl(
    sourceUrl: string,
    options?: any,
  ): Promise<VodAssetOutput> {
    return this.createAssetFromUrl({
      sourceUrl,
      passthrough: options?.recordingId || options?.passthrough,
    });
  }

  async createClip(input: VodCreateClipInput): Promise<VodClipOutput> {
    try {
      this.logger.log(
        `Creating Cloudflare highlight clip from video ${input.parentAssetId} (${input.startTimeSeconds}s -> ${input.endTimeSeconds}s)`,
      );

      const payload = {
        clippedFromVideoUID: input.parentAssetId,
        startTimeSeconds: input.startTimeSeconds,
        endTimeSeconds: input.endTimeSeconds,
        requireSignedURLs: false,
        meta: {
          passthrough: input.passthrough,
        },
      };

      const response = await this.httpClient.post('/clip', payload);
      const result = response.data?.result;

      if (!result?.uid) {
        throw new Error('Cloudflare Stream clip response missing UID');
      }

      const playbackUrl = this.buildPlaybackUrl(result.uid);

      return {
        provider: 'cloudflare',
        clipAssetId: result.uid,
        playbackId: result.uid,
        playbackUrl,
        status: this.mapState(result.status?.state),
        rawProviderResponse: result,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to create Cloudflare highlight clip: ${err.message}`,
        err.stack,
      );
      throw new MediaProviderError(
        err.message || 'Failed to create Cloudflare clip',
        'cloudflare',
        'createClip',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
        err,
      );
    }
  }

  async getAsset(assetId: string): Promise<VodAssetOutput> {
    try {
      const response = await this.httpClient.get(`/${assetId}`);
      const result = response.data?.result;

      if (!result?.uid) {
        throw new Error(`Video asset ${assetId} not found`);
      }

      const playbackUrl = this.buildPlaybackUrl(result.uid);

      return {
        provider: 'cloudflare',
        assetId: result.uid,
        playbackId: result.uid,
        playbackUrl,
        status: this.mapState(result.status?.state),
        durationSeconds: result.duration,
        width: result.input?.width,
        height: result.input?.height,
        rawProviderResponse: result,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to retrieve Cloudflare asset ${assetId}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to retrieve Cloudflare asset',
        'cloudflare',
        'getAsset',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
        err,
      );
    }
  }
}
