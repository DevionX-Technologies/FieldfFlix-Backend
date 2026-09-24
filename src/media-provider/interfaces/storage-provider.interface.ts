import { StorageProviderType } from './media-feature-flags.interface';

export interface StorageUploadUrlInput {
  key: string;
  bucket?: string;
  contentType?: string;
  expiresInSeconds?: number;
}

export interface StorageUploadUrlOutput {
  provider: StorageProviderType;
  uploadUrl: string;
  key: string;
  bucket: string;
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
  generateDownloadPresignedUrl(
    input: StorageDownloadUrlInput,
  ): Promise<StorageDownloadUrlOutput>;
  deleteObject(key: string, bucket?: string): Promise<{ success: boolean }>;
  headObject(
    key: string,
    bucket?: string,
  ): Promise<StorageObjectMetadata | null>;
}
