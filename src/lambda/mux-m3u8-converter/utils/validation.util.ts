import { M3u8ConversionRequest } from '../interfaces/converter.interface';

export class ValidationUtil {
  /**
   * Validates M3U8 conversion request
   */
  static validateRequest(request: M3u8ConversionRequest): {
    isValid: boolean;
    errors: string[];
  } {
    console.log('[ValidationUtil.validateRequest] called with:', request);
    const errors: string[] = [];

    // Validate required fields
    if (!request.muxUrl) {
      errors.push('muxUrl is required');
    }

    if (!request.uploadS3Path) {
      errors.push('uploadS3Path is required');
    }

    if (!request.bucketName) {
      errors.push('bucketName is required');
    }

    // Validate Mux URL format
    if (request.muxUrl && !this.isValidMuxUrl(request.muxUrl)) {
      errors.push(
        'Invalid Mux URL format - must be https://stream.mux.com/{assetId}.m3u8',
      );
    }

    // // Validate S3 path format
    // if (request.uploadS3Path && !this.isValidS3Path(request.uploadS3Path)) {
    //   errors.push(
    //     'Invalid S3 path format - must end with .mp4 and not start with /',
    //   );
    // }

    // Validate bucket name
    if (request.bucketName && !this.isValidBucketName(request.bucketName)) {
      errors.push('Invalid S3 bucket name format');
    }

    // Validate quality
    if (
      request.quality &&
      !['low', 'medium', 'high'].includes(request.quality)
    ) {
      errors.push('Quality must be one of: low, medium, high');
    }

    // Validate output filename if provided
    if (
      request.outputFileName &&
      !this.isValidFileName(request.outputFileName)
    ) {
      errors.push('Invalid output filename');
    }

    console.log('[ValidationUtil.validateRequest] validation result:', {
      isValid: errors.length === 0,
      errors,
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates Mux URL format
   */
  private static isValidMuxUrl(url: string): boolean {
    console.log('[ValidationUtil.isValidMuxUrl] called with:', url);
    try {
      const urlObj = new URL(url);
      const result =
        urlObj.protocol === 'https:' &&
        urlObj.hostname === 'stream.mux.com' &&
        urlObj.pathname.endsWith('.m3u8') &&
        this.extractMuxAssetId(url) !== null;
      console.log('[ValidationUtil.isValidMuxUrl] result:', result);
      return result;
    } catch (e) {
      console.log('[ValidationUtil.isValidMuxUrl] error:', e);
      return false;
    }
  }

  /**
   * Extracts Mux asset ID from Mux URL
   */
  static extractMuxAssetId(muxUrl: string): string | null {
    console.log('[ValidationUtil.extractMuxAssetId] called with:', muxUrl);
    try {
      const urlObj = new URL(muxUrl);
      console.log('[ValidationUtil.extractMuxAssetId] urlObj', urlObj);
      if (urlObj.hostname !== 'stream.mux.com') return null;

      // Extract asset ID from pathname like "/erBWxJnFISoP7tS96a2o01o5JtJQAAY02qoUc800AVmp4k.m3u8"
      const pathname = urlObj.pathname;
      const match = pathname.match(/^\/([^\/]+)\.m3u8$/);
      console.log('[ValidationUtil.extractMuxAssetId] match', match);

      if (match && match[1]) {
        return match[1]; // Return the asset ID
      }
      console.log('[ValidationUtil.extractMuxAssetId] no match');
      return null;
    } catch (e) {
      console.log('[ValidationUtil.extractMuxAssetId] error:', e);
      return null;
    }
  }

  /**
   * Validates filename
   */
  private static isValidFileName(filename: string): boolean {
    console.log('[ValidationUtil.isValidFileName] called with:', filename);
    const invalidChars = /[<>:"/\\|?*]/;
    const result =
      filename.length > 0 &&
      filename.length <= 255 &&
      !invalidChars.test(filename);
    console.log('[ValidationUtil.isValidFileName] result:', result);
    return result;
  }

  /**
   * Sanitizes filename for S3
   */
  static sanitizeFileName(filename: string): string {
    console.log('[ValidationUtil.sanitizeFileName] called with:', filename);
    const sanitized = filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_')
      .substring(0, 100);
    console.log('[ValidationUtil.sanitizeFileName] sanitized:', sanitized);
    return sanitized;
  }

  /**
   * Validates S3 path format
   */
  private static isValidS3Path(s3Path: string): boolean {
    console.log('[ValidationUtil.isValidS3Path] called with:', s3Path);
    // S3 path should not start with / and should end with .mp4
    const result =
      s3Path.length > 0 &&
      !s3Path.startsWith('/') &&
      s3Path.endsWith('.mp4') &&
      s3Path.length <= 1024; // S3 key length limit
    console.log('[ValidationUtil.isValidS3Path] result:', result);
    return result;
  }

  /**
   * Validates S3 bucket name
   */
  private static isValidBucketName(bucketName: string): boolean {
    console.log('[ValidationUtil.isValidBucketName] called with:', bucketName);
    // Basic S3 bucket name validation
    const bucketRegex = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
    const result =
      bucketName.length >= 3 &&
      bucketName.length <= 63 &&
      bucketRegex.test(bucketName) &&
      !bucketName.includes('..') &&
      !/\d+\.\d+\.\d+\.\d+/.test(bucketName); // Not an IP address
    console.log('[ValidationUtil.isValidBucketName] result:', result);
    return result;
  }

  /**
   * Generates filename using Mux asset ID
   */
  static generateUniqueFileName(muxUrl?: string): string {
    console.log('[ValidationUtil.generateUniqueFileName] called with:', muxUrl);
    let baseName = 'converted';

    // Try to extract Mux asset ID for filename
    if (muxUrl) {
      const assetId = this.extractMuxAssetId(muxUrl);
      if (assetId) {
        baseName = assetId;
      }
    }

    const fileName = `${baseName}.mp4`;
    console.log('[ValidationUtil.generateUniqueFileName] result:', fileName);
    return fileName;
  }
}
