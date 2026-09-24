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

@Injectable()
export class CloudflareR2StorageAdapter implements IStorageProvider {
  private readonly logger = new Logger(CloudflareR2StorageAdapter.name);
  readonly providerName: StorageProviderType = 'r2';

  private r2Client: S3Client;
  private defaultBucket: string;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() customClient?: S3Client,
  ) {
    if (customClient) {
      this.r2Client = customClient;
      this.defaultBucket = this.getEnv(
        'CLOUDFLARE_R2_BUCKET_NAME',
        'fieldflicks-media-production',
      );
      return;
    }

    const accountId = this.getEnv('CLOUDFLARE_ACCOUNT_ID', '');
    const accessKeyId = this.getEnv('CLOUDFLARE_R2_ACCESS_KEY_ID', '');
    const secretAccessKey = this.getEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY', '');
    this.defaultBucket = this.getEnv(
      'CLOUDFLARE_R2_BUCKET_NAME',
      'fieldflicks-media-production',
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

    this.r2Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: accessKeyId || 'placeholder-access-key',
        secretAccessKey: secretAccessKey || 'placeholder-secret-key',
      },
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

      const uploadUrl = await getSignedUrl(this.r2Client, command, {
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
    const expiresIn = input.expiresInSeconds || 300; // default 5 minutes for playback

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: input.key,
      });

      const downloadUrl = await getSignedUrl(this.r2Client, command, {
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
        err.$metadata?.httpStatusCode,
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
