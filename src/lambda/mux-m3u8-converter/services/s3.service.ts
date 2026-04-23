import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import { S3UploadResult } from '../interfaces/converter.interface';

export class S3Service {
  private s3Client: S3Client;

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  /**
   * Uploads file to S3 with optimized multipart upload
   */
  async uploadFile(
    filePath: string,
    s3Key: string,
    bucketName: string,
  ): Promise<S3UploadResult> {
    try {
      const fileStats = fs.statSync(filePath);
      const fileStream = fs.createReadStream(filePath);

      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: bucketName,
          Key: s3Key,
          Body: fileStream,
          ContentType: 'video/mp4',
          Metadata: {
            'uploaded-by': 'mux-m3u8-converter',
            'upload-timestamp': new Date().toISOString(),
            'file-size': fileStats.size.toString(),
          },
        },
        // Optimize for large files
        partSize: 10 * 1024 * 1024, // 10MB parts
        queueSize: 3, // Upload 3 parts concurrently
      });

      // Monitor upload progress
      upload.on('httpUploadProgress', (progress) => {
        if (progress.total) {
          const percentage = Math.round(
            (progress.loaded / progress.total) * 100,
          );
          console.log(`Upload progress: ${percentage}%`);
        }
      });

      await upload.done();

      // Generate signed URL
      const signedUrl = await this.generateSignedUrl(s3Key, bucketName);

      return {
        s3Path: s3Key,
        bucketName: bucketName,
        signedUrl,
        fileSize: fileStats.size,
      };
    } catch (error) {
      console.error('S3 upload failed:', error);
      throw new Error(
        `Failed to upload file to S3: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Generates signed URL for S3 object
   */
  async generateSignedUrl(
    s3Key: string,
    bucketName: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      console.error('Failed to generate signed URL:', error);
      throw new Error('Failed to generate signed URL');
    }
  }

  /**
   * Checks if file exists in S3
   */
  async fileExists(s3Key: string, bucketName: string): Promise<boolean> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      });

      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }
}
