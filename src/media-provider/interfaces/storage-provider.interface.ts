import { StorageProviderType } from './media-feature-flags.interface';

export interface StorageUploadUrlInput {
  key: string;
  bucket?: string;
  contentType?: string;
  expiresInSeconds?: number;
  /**
   * When provided, the provider creates a multipart upload and returns
   * per-part presigned URLs. `expectedSizeBytes` is used to derive the part
   * count; omit it and the provider falls back to a single-shot PUT.
   */
  expectedSizeBytes?: number;
  /** Override the provider's default part size (bytes). */
  partSizeBytes?: number;
  /** Override the provider's default part concurrency. */
  concurrency?: number;
}

export interface StorageUploadUrlOutput {
  provider: StorageProviderType;
  uploadUrl: string;
  key: string;
  bucket: string;
  expiresInSeconds: number;
  /**
   * Present only when the caller asked for a multipart upload and the provider
   * could create one. Additive: a client that ignores this still has a working
   * single-shot `uploadUrl` to fall back to.
   */
  multipart?: StorageMultipartUploadOutput;
}

export interface StorageMultipartUploadOutput {
  uploadId: string;
  key: string;
  bucket: string;
  /** Size of each part the client must send, in bytes. */
  partSizeBytes: number;
  /** Total parts the client must upload for the expected object size. */
  partCount: number;
  /** How many parts the client should upload at once. */
  concurrency: number;
  /** Presigned PUT URL per part, index-aligned with partNumber (1-based). */
  partUrls: string[];
  /** Presigned URL that finalizes the upload. Optional: the backend may finalize. */
  completeUrl?: string;
  /** Total parts must be a multiple of this for the non-completion path. */
  expiresInSeconds: number;
}

export interface StorageDownloadUrlInput {
  key: string;
  bucket?: string;
  expiresInSeconds?: number;
}

export interface StorageDownloadUrlOutput {
  provider: StorageProviderType;
  downloadUrl: string;
  expiresInSeconds: number;
}

export interface StorageObjectMetadata {
  key: string;
  bucket: string;
  sizeBytes: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
}

export interface IStorageProvider {
  readonly providerName: StorageProviderType;
  generateUploadPresignedUrl(
    input: StorageUploadUrlInput,
  ): Promise<StorageUploadUrlOutput>;
  /**
   * Finalizes a multipart upload previously started via
   * `generateUploadPresignedUrl({ expectedSizeBytes })`. Providers that do not
   * support multipart may omit this.
   */
  completeMultipartUpload?(
    uploadId: string,
    key: string,
    parts: Array<{ partNumber: number; etag: string }>,
    bucket?: string,
  ): Promise<{ success: boolean; etag?: string }>;
  /** Discards an abandoned multipart upload so parts are not billed forever. */
  abortMultipartUpload?(
    uploadId: string,
    key: string,
    bucket?: string,
  ): Promise<{ success: boolean }>;
  generateDownloadPresignedUrl(
    input: StorageDownloadUrlInput,
  ): Promise<StorageDownloadUrlOutput>;
  deleteObject(key: string, bucket?: string): Promise<{ success: boolean }>;
  headObject(
    key: string,
    bucket?: string,
  ): Promise<StorageObjectMetadata | null>;
}
