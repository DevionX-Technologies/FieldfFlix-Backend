export interface M3u8ConversionRequest {
  muxUrl: string; // M3U8 URL to convert
  uploadS3Path: string; // S3 path prefix for upload
  bucketName: string; // S3 bucket name
  outputFileName?: string; // Optional output filename
  quality?: 'low' | 'medium' | 'high'; // Video quality preset
}

export interface M3u8ConversionResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    signedUrl?: string;
    s3Path?: string;
    bucketName?: string;
    fileSize?: number;
    fileName?: string;
  };
  requestId?: string;
}

export interface S3UploadResult {
  s3Path: string;
  bucketName: string;
  signedUrl: string;
  fileSize: number;
}

export interface ConversionMetadata {
  muxUrl: string;
  outputFormat: 'mp4';
  quality: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  fileSize?: number;
}

export interface FFmpegOptions {
  inputFormat: string;
  outputFormat: string;
  quality: string;
  maxDuration?: number;
  videoCodec?: string;
  audioCodec?: string;
}
