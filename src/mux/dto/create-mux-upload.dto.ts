import { IsString, IsUrl, IsUUID } from 'class-validator';

/**
 * Defines the data structure for initiating an S3 to Mux upload.
 */
export class CreateMuxUploadDto {
  /**
   * The pre-signed S3 URL of the file to upload.
   * @example "https://s3.amazonaws.com/..."
   */
  @IsUrl()
  s3Url: string;

  /**
   * The object key of the file in the S3 bucket.
   * @example "videos/my-video.mp4"
   */
  @IsString()
  key: string;

  /**
   * The ID of the recording associated with this upload.
   * @example "a1b2c3d4-e5f6-7890-1234-567890abcdef"
   */
  @IsUUID()
  recordingId: string;
}
