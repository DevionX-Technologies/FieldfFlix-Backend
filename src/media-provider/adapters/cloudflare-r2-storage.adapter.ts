import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IStorageProvider,
  StorageDownloadUrlInput,
  StorageDownloadUrlOutput,
  StorageObjectMetadata,
  StorageUploadUrlInput,
  StorageUploadUrlOutput,
} from '../interfaces/storage-provider.interface';
import { StorageProviderType } from '../interfaces/media-feature-flags.interface';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MediaProviderError } from '../errors/media-provider.error';
import {
  buildR2PublicUrl,
  isR2PublicDeliveryEnabled,
} from '../utils/r2-public-url';

@Injectable()
export class CloudflareR2StorageAdapter implements IStorageProvider {
  private readonly logger = new Logger(CloudflareR2StorageAdapter.name);
  readonly providerName: StorageProviderType = 'r2';

  private r2Client: S3Client;
  /** Separate client for presigned GET URLs — R2 requires virtual-hosted style (no forcePathStyle) */
  private r2PresignClient: S3Client;
  private defaultBucket: string;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() customClient?: S3Client,
  ) {
    if (customClient) {
      this.r2Client = customClient;
      this.r2PresignClient = customClient;
      this.defaultBucket = this.getEnv(
        'CLOUDFLARE_R2_BUCKET_NAME',
        'fieldflicks-media-production',
      );
      return;
    }

    const accountId = this.getAccountId();
    const accessKeyId = this.getEnv('CLOUDFLARE_R2_ACCESS_KEY_ID', '');
    const secretAccessKey = this.getEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY', '');
    this.defaultBucket = this.getEnv(
      'CLOUDFLARE_R2_BUCKET_NAME',
      'fieldflicks-storage',
    );

    if (!accountId || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'Cloudflare R2 credentials (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY) not fully configured. Using mock/stub client until configured.',
      );
    }

    const explicitEndpoint = this.getEnv('CLOUDFLARE_R2_ENDPOINT', '');
    const endpoint = explicitEndpoint
      ? explicitEndpoint
      : accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : 'https://placeholder.r2.cloudflarestorage.com';

    const credentials = {
      accessKeyId: accessKeyId || 'placeholder-access-key',
      secretAccessKey: secretAccessKey || 'placeholder-secret-key',
    };

    // Path-style client for object operations (head/list/delete).
    this.r2Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials,
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    // Presigning client. `requestChecksumCalculation: 'WHEN_REQUIRED'` is
    // mandatory, not cosmetic: with the SDK default the flexible-checksums
    // middleware puts `x-amz-checksum-mode` into X-Amz-SignedHeaders, and R2
    // then answers 403 SignatureDoesNotMatch for any client that does not echo
    // that header back (expo-video does not). Stays path-style so the URL
    // matches R2's canonical <endpoint>/<bucket>/<key> form.
    this.r2PresignClient = new S3Client({
      region: 'auto',
      endpoint,
      credentials,
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private getEnv(key: string, defaultValue: string): string {
    if (this.configService) {
      return (
        this.configService.get<string>(key) ?? process.env[key] ?? defaultValue
      );
    }
    return process.env[key] ?? defaultValue;
  }

  /**
   * The account id lives under two different names depending on which env file
   * was deployed: `CLOUDFLARE_ACCOUNT_ID` (used by the Stream adapters) and
   * `CLOUDFLARE_R2_ACCOUNT_ID` (set by the R2 onboarding snippets). Accept
   * either so a missing alias can never silently produce the placeholder
   * endpoint.
   */
  private getAccountId(): string {
    return (
      this.getEnv('CLOUDFLARE_ACCOUNT_ID', '') ||
      this.getEnv('CLOUDFLARE_R2_ACCOUNT_ID', '')
    );
  }

  /**
   * Direct, unsigned public URL for an object, or null when no public delivery
   * domain is configured. Preferred over presigning for playback because the
   * SDK's presigned GetObject URLs 403 on R2 unless the caller echoes the
   * signed `x-amz-checksum-mode` header.
   */
  getPublicObjectUrl(key: string, bucket?: string): string | null {
    const targetBucket = bucket || this.defaultBucket;
    if (!isR2PublicDeliveryEnabled()) return null;
    if (targetBucket !== this.defaultBucket) return null;
    return buildR2PublicUrl(key);
  }

  /**
   * Canonical playback URL for an R2 object: public URL when the bucket is
   * publicly readable (stable, no expiry, survives Range requests), otherwise a
   * presigned GET. Verifies the object exists first so callers never hand the
   * client a URL that 404s.
   */
  async resolvePlaybackUrl(
    key: string,
    bucket?: string,
    expiresInSeconds = 21600,
  ): Promise<{ url: string; source: 'public' | 'presigned' } | null> {
    const targetBucket = bucket || this.defaultBucket;

    const object = await this.headObject(key, targetBucket);
    if (!object || object.sizeBytes <= 0) return null;

    const publicUrl = this.getPublicObjectUrl(key, targetBucket);
    if (publicUrl) return { url: publicUrl, source: 'public' };

    const presigned = await this.generateDownloadPresignedUrl({
      key,
      bucket: targetBucket,
      expiresInSeconds,
    });
    return { url: presigned.downloadUrl, source: 'presigned' };
  }

  async generateUploadPresignedUrl(
    input: StorageUploadUrlInput,
  ): Promise<StorageUploadUrlOutput> {
    const bucket = input.bucket || this.defaultBucket;
    const expiresIn = input.expiresInSeconds || 3600;

    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        ContentType: input.contentType || 'video/mp4',
      });

      const uploadUrl = await getSignedUrl(this.r2PresignClient, command, {
        expiresIn,
      });

      return {
        provider: 'r2',
        uploadUrl,
        key: input.key,
        bucket,
        expiresInSeconds: expiresIn,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to generate R2 upload presigned URL for ${input.key}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to generate R2 presigned upload URL',
        'r2',
        'generateUploadPresignedUrl',
        false,
        err.$metadata?.httpStatusCode,
        err,
      );
    }
  }

  async generateDownloadPresignedUrl(
    input: StorageDownloadUrlInput,
  ): Promise<StorageDownloadUrlOutput> {
    const bucket = input.bucket || this.defaultBucket;
    const expiresIn = input.expiresInSeconds || 21600; // 6h playback window

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: input.key,
        // Never request a checksum payload: R2 rejects presigned GETs that
        // sign x-amz-checksum-mode with 403 SignatureDoesNotMatch.
        ChecksumMode: undefined,
      });

      // Must use r2PresignClient (checksum calc disabled) — r2Client signs
      // x-amz-checksum-mode and every consumer 403s.
      const downloadUrl = await getSignedUrl(this.r2PresignClient, command, {
        expiresIn,
      });

      return {
        provider: 'r2',
        downloadUrl,
        expiresInSeconds: expiresIn,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to generate R2 download presigned URL for ${input.key}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to generate R2 presigned download URL',
        'r2',
        'generateDownloadPresignedUrl',
        false,
        err?.$metadata?.httpStatusCode,
        err,
      );
    }
  }

  async deleteObject(
    key: string,
    bucket?: string,
  ): Promise<{ success: boolean }> {
    const targetBucket = bucket || this.defaultBucket;
    try {
      await this.r2Client.send(
        new DeleteObjectCommand({
          Bucket: targetBucket,
          Key: key,
        }),
      );
      return { success: true };
    } catch (err: any) {
      this.logger.error(
        `Failed to delete R2 object ${key} in ${targetBucket}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to delete R2 object',
        'r2',
        'deleteObject',
        false,
        err.$metadata?.httpStatusCode,
        err,
      );
    }
  }

  async headObject(
    key: string,
    bucket?: string,
  ): Promise<StorageObjectMetadata | null> {
    const targetBucket = bucket || this.defaultBucket;
    try {
      const res = await this.r2Client.send(
        new HeadObjectCommand({
          Bucket: targetBucket,
          Key: key,
        }),
      );

      return {
        key,
        bucket: targetBucket,
        sizeBytes: res.ContentLength ?? 0,
        contentType: res.ContentType,
        lastModified: res.LastModified,
        etag: res.ETag,
      };
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      this.logger.error(
        `Failed to head R2 object ${key} in ${targetBucket}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to head R2 object',
        'r2',
        'headObject',
        false,
        err.$metadata?.httpStatusCode,
        err,
      );
    }
  }

  async listObjects(
    prefix: string,
    bucket?: string,
    maxKeys = 1000,
  ): Promise<StorageObjectMetadata[]> {
    const targetBucket = bucket || this.defaultBucket;
    try {
      const res = await this.r2Client.send(
        new ListObjectsV2Command({
          Bucket: targetBucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
        }),
      );

      return (
        res.Contents?.map((item) => ({
          key: item.Key || '',
          bucket: targetBucket,
          sizeBytes: item.Size ?? 0,
          lastModified: item.LastModified,
          etag: item.ETag,
        })) || []
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to list R2 objects with prefix ${prefix}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to list R2 objects',
        'r2',
        'listObjects',
        false,
        err.$metadata?.httpStatusCode,
        err,
      );
    }
  }
}
