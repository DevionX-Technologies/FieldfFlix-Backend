import { Inject, Injectable, Logger } from '@nestjs/common';
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
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AWSS3Bucket } from '../../constant/providers.constant';
import { MediaProviderError } from '../errors/media-provider.error';

@Injectable()
export class AwsS3StorageAdapter implements IStorageProvider {
  private readonly logger = new Logger(AwsS3StorageAdapter.name);
  readonly providerName: StorageProviderType = 's3';

  constructor(@Inject(AWSS3Bucket) private readonly s3: S3Client) {}

  private getDefaultBucket(): string {
    return (
      process.env.AWS_S3_BUCKET_NAME ||
      process.env.AWS_PROFILE_BUCKET_NAME ||
      'fieldflicks-production-media'
    );
  }

  async generateUploadPresignedUrl(
    input: StorageUploadUrlInput,
  ): Promise<StorageUploadUrlOutput> {
    const bucket = input.bucket || this.getDefaultBucket();
    const expiresIn = input.expiresInSeconds || 3600;

    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        ContentType: input.contentType || 'video/mp4',
      });

      const uploadUrl = await getSignedUrl(this.s3, command, {
        expiresIn,
      });

      return {
        provider: 's3',
        uploadUrl,
        key: input.key,
        bucket,
        expiresInSeconds: expiresIn,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to generate S3 upload presigned URL for ${input.key}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to generate S3 presigned upload URL',
        's3',
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
    const bucket = input.bucket || this.getDefaultBucket();
    const expiresIn = input.expiresInSeconds || 3600;

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: input.key,
      });

      const downloadUrl = await getSignedUrl(this.s3, command, {
        expiresIn,
      });

      return {
        provider: 's3',
        downloadUrl,
        expiresInSeconds: expiresIn,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to generate S3 download presigned URL for ${input.key}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to generate S3 presigned download URL',
        's3',
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
    const targetBucket = bucket || this.getDefaultBucket();
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: targetBucket,
          Key: key,
        }),
      );
      return { success: true };
    } catch (err: any) {
      this.logger.error(
        `Failed to delete S3 object ${key} from ${targetBucket}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to delete S3 object',
        's3',
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
    const targetBucket = bucket || this.getDefaultBucket();
    try {
      const res = await this.s3.send(
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
        `Failed to head S3 object ${key} in ${targetBucket}: ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to head S3 object',
        's3',
        'headObject',
        false,
        err.$metadata?.httpStatusCode,
        err,
      );
    }
  }
}
