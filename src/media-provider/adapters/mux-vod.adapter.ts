import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
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
import { MuxService } from '../../mux/mux.service';
import { MUX_API_BASE_URL } from '../../constant/constant';
import { MediaProviderError } from '../errors/media-provider.error';

@Injectable()
export class MuxVodAdapter implements IVodProvider {
  private readonly logger = new Logger(MuxVodAdapter.name);
  readonly providerName: VodProviderType = 'mux';

  constructor(private readonly muxService: MuxService) {}

  private getAuthHeader(): string {
    const tokenId = process.env.MUX_TOKEN_ID || '';
    const tokenSecret = process.env.MUX_TOKEN_SECRET || '';
    return `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`;
  }

  async createDirectUpload(
    input: VodDirectUploadInput,
  ): Promise<VodDirectUploadOutput> {
    try {
      const res = await this.muxService.createDirectUpload(
        input.passthrough || 'direct_upload',
      );
      return {
        provider: 'mux',
        uploadUrl: res.uploadUrl,
        uploadId: res.uploadId,
      };
    } catch (err: any) {
      this.logger.error(`Mux direct upload failed: ${err.message}`, err.stack);
      throw new MediaProviderError(
        err.message || 'Failed to create Mux direct upload',
        'mux',
        'createDirectUpload',
        false,
        err.status,
        err,
      );
    }
  }

  async createAssetFromUrl(
    input: VodCreateAssetInput,
  ): Promise<VodAssetOutput> {
    try {
      const payload: Record<string, any> = {
        input: [{ url: input.sourceUrl }],
        playback_policy: ['public'],
        passthrough: input.passthrough,
      };

      if (input.watermarkUrl) {
        payload.input.push({
          url: input.watermarkUrl,
          overlay_settings: {
            vertical_align: 'top',
            horizontal_align: 'right',
            opacity: '0.8',
          },
        });
      }

      const response = await axios.post(
        `${MUX_API_BASE_URL}/video/v1/assets`,
        payload,
        {
          headers: {
            Authorization: this.getAuthHeader(),
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const asset = response.data?.data;
      const playbackId = asset?.playback_ids?.[0]?.id;

      return {
        provider: 'mux',
        assetId: asset?.id,
        playbackId,
        playbackUrl: playbackId
          ? `https://stream.mux.com/${playbackId}.m3u8`
          : undefined,
        status: asset?.status || 'preparing',
        durationSeconds: asset?.duration,
        rawProviderResponse: asset,
      };
    } catch (err: any) {
      this.logger.error(`Mux asset creation from URL failed: ${err.message}`);
      throw new MediaProviderError(
        err.message || 'Failed to create Mux asset from URL',
        'mux',
        'createAssetFromUrl',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
        err,
      );
    }
  }

  async createClip(input: VodCreateClipInput): Promise<VodClipOutput> {
    try {
      const response = await axios.post(
        `${MUX_API_BASE_URL}/video/v1/assets`,
        {
          input: [
            {
              url: `mux://assets/${input.parentAssetId}`,
              start_time: input.startTimeSeconds,
              end_time: input.endTimeSeconds,
            },
          ],
          playback_policy: ['public'],
          passthrough: input.passthrough,
        },
        {
          headers: {
            Authorization: this.getAuthHeader(),
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const asset = response.data?.data;
      const playbackId = asset?.playback_ids?.[0]?.id;

      return {
        provider: 'mux',
        clipAssetId: asset?.id,
        playbackId,
        playbackUrl: playbackId
          ? `https://stream.mux.com/${playbackId}.m3u8`
          : undefined,
        status: asset?.status || 'preparing',
        rawProviderResponse: asset,
      };
    } catch (err: any) {
      this.logger.error(`Mux clip creation failed: ${err.message}`);
      throw new MediaProviderError(
        err.message || 'Failed to create Mux clip',
        'mux',
        'createClip',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
        err,
      );
    }
  }

  async getAsset(assetId: string): Promise<VodAssetOutput> {
    try {
      const response = await axios.get(
        `${MUX_API_BASE_URL}/video/v1/assets/${assetId}`,
        {
          headers: {
            Authorization: this.getAuthHeader(),
          },
          timeout: 15000,
        },
      );

      const asset = response.data?.data;
      const playbackId = asset?.playback_ids?.[0]?.id;

      return {
        provider: 'mux',
        assetId: asset?.id,
        playbackId,
        playbackUrl: playbackId
          ? `https://stream.mux.com/${playbackId}.m3u8`
          : undefined,
        status: asset?.status || 'unknown',
        durationSeconds: asset?.duration,
        width: asset?.tracks?.find((t: any) => t.type === 'video')?.max_width,
        height: asset?.tracks?.find((t: any) => t.type === 'video')?.max_height,
        rawProviderResponse: asset,
      };
    } catch (err: any) {
      this.logger.error(`Failed to get Mux asset ${assetId}: ${err.message}`);
      throw new MediaProviderError(
        err.message || 'Failed to retrieve Mux asset',
        'mux',
        'getAsset',
        err.response?.status === 429 || err.response?.status >= 500,
        err.response?.status,
        err,
      );
    }
  }
}
