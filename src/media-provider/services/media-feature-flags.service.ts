import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IMediaFeatureFlags,
  LiveProviderType,
  MediaContext,
  StorageProviderType,
  VodProviderType,
} from '../interfaces/media-feature-flags.interface';

@Injectable()
export class MediaFeatureFlagsService implements IMediaFeatureFlags {
  private readonly logger = new Logger(MediaFeatureFlagsService.name);

  // Runtime overrides for testing or temporary pilot scoping
  private storageOverride: StorageProviderType | null = null;
  private liveOverride: LiveProviderType | null = null;
  private vodOverride: VodProviderType | null = null;

  constructor(private readonly configService?: ConfigService) {}

  private getEnv(key: string, defaultValue: string): string {
    if (this.configService) {
      return (
        this.configService.get<string>(key) ?? process.env[key] ?? defaultValue
      );
    }
    return process.env[key] ?? defaultValue;
  }

  private isContextAllowed(
    context: MediaContext | undefined,
    tournamentEnvVar: string,
    turfEnvVar: string,
  ): boolean {
    if (!context) return false;

    if (context.tournamentId) {
      const allowedTournaments = this.getEnv(tournamentEnvVar, '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (
        allowedTournaments.length > 0 &&
        allowedTournaments.includes(context.tournamentId.toLowerCase())
      ) {
        return true;
      }
    }

    if (context.turfId) {
      const allowedTurfs = this.getEnv(turfEnvVar, '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (
        allowedTurfs.length > 0 &&
        allowedTurfs.includes(context.turfId.toLowerCase())
      ) {
        return true;
      }
    }

    return false;
  }

  getStorageProvider(context?: MediaContext): StorageProviderType {
    if (this.storageOverride) return this.storageOverride;

    // Check contextual scoping for Cloudflare R2 pilot
    if (
      this.isContextAllowed(
        context,
        'CLOUDFLARE_FEATURE_FLAG_TOURNAMENT_IDS',
        'CLOUDFLARE_FEATURE_FLAG_TURF_IDS',
      )
    ) {
      return 'r2';
    }

    const envProvider = this.getEnv('MEDIA_STORAGE_PROVIDER', '');
    if (envProvider) {
      return envProvider.toLowerCase() === 'r2' ? 'r2' : 's3';
    }
    
    // Default to R2 if CLOUDFLARE_R2_BUCKET_NAME is present
    if (process.env.CLOUDFLARE_R2_BUCKET_NAME) {
      return 'r2';
    }
    
    return 's3';
  }

  getLiveProvider(context?: MediaContext): LiveProviderType {
    if (this.liveOverride) return this.liveOverride;

    // Check contextual scoping for Cloudflare Stream Live pilot
    if (
      this.isContextAllowed(
        context,
        'CLOUDFLARE_FEATURE_FLAG_TOURNAMENT_IDS',
        'CLOUDFLARE_FEATURE_FLAG_TURF_IDS',
      )
    ) {
      return 'cloudflare';
    }

    const provider = this.getEnv(
      'MEDIA_LIVE_PROVIDER',
      'mux',
    ).toLowerCase() as LiveProviderType;
    return provider === 'cloudflare' ? 'cloudflare' : 'mux';
  }

  getVodProvider(context?: MediaContext): VodProviderType {
    if (this.vodOverride) return this.vodOverride;

    // Check contextual scoping for Cloudflare VOD pilot
    if (
      this.isContextAllowed(
        context,
        'CLOUDFLARE_FEATURE_FLAG_TOURNAMENT_IDS',
        'CLOUDFLARE_FEATURE_FLAG_TURF_IDS',
      )
    ) {
      return 'cloudflare';
    }

    const envProvider = this.getEnv('MEDIA_VOD_PROVIDER', '');
    if (envProvider) {
      return envProvider.toLowerCase() === 'cloudflare' ? 'cloudflare' : 'mux';
    }
    
    // Default to Cloudflare Stream if R2 is configured
    if (process.env.CLOUDFLARE_R2_BUCKET_NAME) {
      return 'cloudflare';
    }
    
    return 'mux';
  }

  isCloudflareStorageEnabled(context?: MediaContext): boolean {
    return this.getStorageProvider(context) === 'r2';
  }

  isCloudflareLiveEnabled(context?: MediaContext): boolean {
    return this.getLiveProvider(context) === 'cloudflare';
  }

  isCloudflareVodEnabled(context?: MediaContext): boolean {
    return this.getVodProvider(context) === 'cloudflare';
  }

  // Runtime control methods for testing or administrative switches
  setStorageProviderOverride(override: StorageProviderType | null): void {
    this.logger.warn(`Storage provider override set to: ${override}`);
    this.storageOverride = override;
  }

  setLiveProviderOverride(override: LiveProviderType | null): void {
    this.logger.warn(`Live provider override set to: ${override}`);
    this.liveOverride = override;
  }

  setVodProviderOverride(override: VodProviderType | null): void {
    this.logger.warn(`VOD provider override set to: ${override}`);
    this.vodOverride = override;
  }
}
