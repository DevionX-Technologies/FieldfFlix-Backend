export interface MuxUploadLambdaEvent {
  recordingId: string;
  s3Key: string;
  bucketName?: string;
  presignedUrl?: string;
  watermarkKey?: string;
  watermarkBucketName?: string;
}

export interface MuxUploadLambdaResult {
  success: boolean;
  recordingId: string;
  message: string;
  muxAssetId?: string;
  muxPlaybackId?: string;
  muxMediaUrl?: string;
  error?: string;
}
