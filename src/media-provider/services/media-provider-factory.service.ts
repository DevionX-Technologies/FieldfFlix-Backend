import { Injectable, Logger } from '@nestjs/common';
import { MediaFeatureFlagsService } from './media-feature-flags.service';
import { ILiveStreamProvider } from '../interfaces/live-stream-provider.interface';
import { IStorageProvider } from '../interfaces/storage-provider.interface';
import { IVodProvider } from '../interfaces/vod-provider.interface';
import {
  LiveProviderType,
  MediaContext,
  StorageProviderType,
  VodProviderType,
} from '../interfaces/media-feature-flags.interface';
import { MuxLiveAdapter } from '../adapters/mux-live.adapter';
import { MuxVodAdapter } from '../adapters/mux-vod.adapter';
import { AwsS3StorageAdapter } from '../adapters/aws-s3-storage.adapter';
import { CloudflareR2StorageAdapter } from '../adapters/cloudflare-r2-storage.adapter';
import { CloudflareStreamLiveAdapter } from '../adapters/cloudflare-stream-live.adapter';
import { CloudflareStreamVodAdapter } from '../adapters/cloudflare-stream-vod.adapter';

@Injectable()
export class MediaProviderFactory {
  private readonly logger = new Logger(MediaProviderFactory.name);

  private readonly liveProviders = new Map<
    LiveProviderType,
    ILiveStreamProvider
  >();
  private readonly storageProviders = new Map<
    StorageProviderType,
    IStorageProvider
  >();
  private readonly vodProviders = new Map<VodProviderType, IVodProvider>();

  constructor(
    private readonly featureFlags: MediaFeatureFlagsService,
    private readonly muxLiveAdapter: MuxLiveAdapter,
    private readonly muxVodAdapter: MuxVodAdapter,
    private readonly awsS3StorageAdapter: AwsS3StorageAdapter,
    private readonly cloudflareR2StorageAdapter?: CloudflareR2StorageAdapter,
    private readonly cloudflareStreamLiveAdapter?: CloudflareStreamLiveAdapter,
    private readonly cloudflareStreamVodAdapter?: CloudflareStreamVodAdapter,
  ) {
    // Register baseline legacy providers
    this.registerLiveProvider(this.muxLiveAdapter);
    this.registerVodProvider(this.muxVodAdapter);
    this.registerStorageProvider(this.awsS3StorageAdapter);

    if (this.cloudflareR2StorageAdapter) {
      this.registerStorageProvider(this.cloudflareR2StorageAdapter);
    }

    if (this.cloudflareStreamLiveAdapter) {
      this.registerLiveProvider(this.cloudflareStreamLiveAdapter);
    }

    if (this.cloudflareStreamVodAdapter) {
      this.registerVodProvider(this.cloudflareStreamVodAdapter);
    }
  }

  registerLiveProvider(provider: ILiveStreamProvider): void {
    this.liveProviders.set(provider.providerName, provider);
    this.logger.log(`Registered live provider: ${provider.providerName}`);
  }

  registerStorageProvider(provider: IStorageProvider): void {
    this.storageProviders.set(provider.providerName, provider);
    this.logger.log(`Registered storage provider: ${provider.providerName}`);
  }

  registerVodProvider(provider: IVodProvider): void {
    this.vodProviders.set(provider.providerName, provider);
    this.logger.log(`Registered VOD provider: ${provider.providerName}`);
  }

  getLiveStreamProvider(context?: MediaContext): ILiveStreamProvider {
    const selected = this.featureFlags.getLiveProvider(context);
    const provider = this.liveProviders.get(selected);

    if (!provider) {
      this.logger.warn(
        `Live provider "${selected}" requested but not registered. Falling back to Mux.`,
      );
      return this.muxLiveAdapter;
    }

    return provider;
  }

  getStorageProvider(context?: MediaContext): IStorageProvider {
    const selected = this.featureFlags.getStorageProvider(context);
    const provider = this.storageProviders.get(selected);

    if (!provider) {
      this.logger.warn(
        `Storage provider "${selected}" requested but not registered. Falling back to S3.`,
      );
      return this.awsS3StorageAdapter;
    }

    return provider;
  }

  getVodProvider(context?: MediaContext): IVodProvider {
    const selected = this.featureFlags.getVodProvider(context);
    const provider = this.vodProviders.get(selected);

    if (!provider) {
      this.logger.warn(
        `VOD provider "${selected}" requested but not registered. Falling back to Mux.`,
      );
      return this.muxVodAdapter;
    }

    return provider;
  }
}
