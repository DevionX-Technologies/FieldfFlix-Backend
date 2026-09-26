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
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
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
      forcePathStyle: true, // Revert to true as R2 works best with path-style
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    // Explicitly strip the problematic checksum header that breaks R2 presigned GETs
    this.r2PresignClient.middlewareStack.add(
      (next) => async (args: any) => {
        if (args.request && args.request.query) {
          delete args.request.query['x-amz-checksum-mode'];
          delete args.request.query['x-amz-checksum-crc32'];
          delete args.request.query['x-amz-sdk-checksum-algorithm'];
        }
        if (args.request && args.request.headers) {
          delete args.request.headers['x-amz-checksum-mode'];
          delete args.request.headers['x-amz-checksum-crc32'];
          delete args.request.headers['x-amz-sdk-checksum-algorithm'];
        }
        return next(args);
      },
      {
        step: 'finalizeRequest',
        name: 'removeChecksumMode',
        priority: 'low',
      },
    );
  }

  /**
   * R2 (like S3) rejects any part smaller than 5 MiB except the last one.
   * Clamping here keeps a misconfigured part size from failing every upload
   * at CompleteMultipartUpload time.
   */
  private static readonly MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
  private static readonly DEFAULT_PART_SIZE_BYTES = 64 * 1024 * 1024;
  private static readonly DEFAULT_PART_CONCURRENCY = 3;
  /** R2 allows at most 10,000 parts per multipart upload. */
  private static readonly MAX_PARTS = 10000;

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
      // Multipart is strictly better for the multi-GB recordings this system
      // handles: parallel parts, per-part retry, and resumability. But it is
      // only offered when the caller knows the object size, because the part
      // count is derived from it. A device that ignores `multipart` still has
      // the single-shot `uploadUrl` below, so this stays backward compatible.
      if (input.expectedSizeBytes && input.expectedSizeBytes > 0) {
        try {
          const multipart = await this.createMultipartUploadPlan(
            bucket,
            input.key,
            input.contentType || 'video/mp4',
            input.expectedSizeBytes,
            input.partSizeBytes,
            input.concurrency,
            expiresIn,
          );
          // Still return a valid single-shot URL as the fallback path.
          const singleCommand = new PutObjectCommand({
            Bucket: bucket,
            Key: input.key,
            ContentType: input.contentType || 'video/mp4',
          });
          const uploadUrl = await getSignedUrl(
            this.r2PresignClient,
            singleCommand,
            {
              expiresIn,
            },
          );
          this.logger.log(
            `R2 multipart upload planned for ${input.key}: ` +
              `${multipart.partCount} parts x ${multipart.partSizeBytes}B, concurrency ${multipart.concurrency}, uploadId=${multipart.uploadId}`,
          );
          return {
            provider: 'r2',
            uploadUrl,
            key: input.key,
            bucket,
            expiresInSeconds: expiresIn,
            multipart,
          };
        } catch (multipartErr: any) {
          // Never fail the request because multipart could not be created;
          // a single-shot PUT still works, just slower.
          this.logger.warn(
            `Falling back to single-shot R2 upload for ${input.key}: ${multipartErr?.message}`,
          );
        }
      }

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
        err.message || 'Failed to generate R2 upload presigned URL',
        'r2',
        'generateUploadPresignedUrl',
        false,
        err.$metadata?.httpStatusCode,
        err,
      );
    }
  }

  /**
   * Creates the multipart upload and presigns every part URL up front.
   *
   * The venue device therefore never holds R2 credentials — only short-lived,
   * per-part URLs scoped to a single upload. Part URLs are signed in parallel
   * because presigning is pure local CPU work (SigV4 HMAC), not a network call.
   */
  private async createMultipartUploadPlan(
    bucket: string,
    key: string,
    contentType: string,
    expectedSizeBytes: number,
    partSizeOverride?: number,
    concurrencyOverride?: number,
    expiresIn = 3600,
  ): Promise<NonNullable<StorageUploadUrlOutput['multipart']>> {
    let partSize = partSizeOverride ?? this.defaultPartSize();
    partSize = Math.max(
      Math.floor(partSize),
      CloudflareR2StorageAdapter.MIN_PART_SIZE_BYTES,
    );

    let partCount = Math.ceil(expectedSizeBytes / partSize);
    if (partCount > CloudflareR2StorageAdapter.MAX_PARTS) {
      // Grow the part size rather than fail: a 10,000-part cap is the only
      // hard limit, and 2-3 GB never approaches it at 64 MiB parts.
      partSize = Math.ceil(
        expectedSizeBytes / CloudflareR2StorageAdapter.MAX_PARTS,
      );
      partCount = Math.ceil(expectedSizeBytes / partSize);
      this.logger.warn(
        `Raised part size to ${partSize}B for ${key} to stay within the ${CloudflareR2StorageAdapter.MAX_PARTS}-part limit`,
      );
    }

    const created = await this.r2Client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
    );

    const uploadId = created.UploadId;
    if (!uploadId) throw new Error('R2 did not return an UploadId');

    const concurrency = Math.max(
      1,
      Math.min(
        concurrencyOverride ?? this.defaultConcurrency(),
        CloudflareR2StorageAdapter.MAX_PARTS,
      ),
    );

    const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
    const partUrls = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const signed = await getSignedUrl(
          this.r2PresignClient,
          new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn },
        );
        return signed;
      }),
    );

    return {
      uploadId,
      key,
      bucket,
      partSizeBytes: partSize,
      partCount,
      concurrency,
      partUrls,
      expiresInSeconds: expiresIn,
    };
  }

  private defaultPartSize(): number {
    const raw = this.getEnv('R2_UPLOAD_PART_SIZE_BYTES', '');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : CloudflareR2StorageAdapter.DEFAULT_PART_SIZE_BYTES;
  }

  private defaultConcurrency(): number {
    const raw = this.getEnv('R2_UPLOAD_CONCURRENCY', '');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : CloudflareR2StorageAdapter.DEFAULT_PART_CONCURRENCY;
  }

  async completeMultipartUpload(
    uploadId: string,
    key: string,
    parts: Array<{ partNumber: number; etag: string }>,
    bucket?: string,
  ): Promise<{ success: boolean; etag?: string }> {
    const targetBucket = bucket || this.defaultBucket;
    try {
      // S3/R2 require ascending part numbers.
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const res = await this.r2Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: targetBucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: ordered.map((p) => ({
              PartNumber: p.partNumber,
              ETag: p.etag,
            })),
          },
        }),
      );
      this.logger.log(
        `Completed R2 multipart upload for ${key} (${ordered.length} parts, uploadId=${uploadId})`,
      );
      return { success: true, etag: res.ETag };
    } catch (err: any) {
      this.logger.error(
        `Failed to complete R2 multipart upload for ${key} (uploadId=${uploadId}): ${err.message}`,
      );
      throw new MediaProviderError(
        err.message || 'Failed to complete multipart upload',
        'r2',
        'completeMultipartUpload',
        err.name === 'SlowDown' || err.name === 'ServiceUnavailable',
        err.$metadata?.httpStatusCode,
        err,
      );
    }
  }

  async abortMultipartUpload(
    uploadId: string,
    key: string,
    bucket?: string,
  ): Promise<{ success: boolean }> {
    const targetBucket = bucket || this.defaultBucket;
    try {
      await this.r2Client.send(
        new AbortMultipartUploadCommand({
          Bucket: targetBucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
      this.logger.log(
        `Aborted R2 multipart upload for ${key} (uploadId=${uploadId})`,
      );
      return { success: true };
    } catch (err: any) {
      this.logger.warn(
        `Failed to abort R2 multipart upload for ${key} (uploadId=${uploadId}): ${err.message}`,
      );
      return { success: false };
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
