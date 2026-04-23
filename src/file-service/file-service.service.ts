import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UploadFileInS3Dto } from './dto/file.dto';
import {
  DeleteObjectCommand,
  ObjectCannedACL,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage'; // For multipart uploads
import { AWSS3Bucket } from 'src/constant/providers.constant';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
export interface IFileUploadResult {
  url: string;
}

@Injectable()
export class FileServiceService {
  private readonly logger = new Logger(FileServiceService.name);
  constructor(@Inject(AWSS3Bucket) private readonly s3: S3Client) {}

  private constructFileName(file: {
    subfolder?: string;
    fileName: string;
  }): string {
    const subfolderPrefix = file.subfolder ? `${file.subfolder}` : '';
    return `${subfolderPrefix}${file.fileName}`;
  }

  private async createPresignedUrl(
    fileName: string,
    contentType: string,
    tagsQueryString: string,
    bucket: string,
  ): Promise<string> {
    const bucketName = `${process.env.APP_NAME}-${process.env.ENVIRONMENT}-${bucket}`;
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      ContentType: contentType,
      ACL: ObjectCannedACL.public_read,
      Tagging: tagsQueryString,
    });

    // Generate the signed URL
    return getSignedUrl(this.s3, command, { expiresIn: 60 * 5 }); // Expires in 5 minutes
  }

  private constructTagsQueryString(tags?: Record<string, string>): string {
    return tags
      ? Object.entries(tags)
          .map(
            ([key, value]) =>
              `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
          )
          .join('&')
      : '';
  }

  async generatePresignedUrls(
    createFileServiceDto: UploadFileInS3Dto,
  ): Promise<any[]> {
    try {
      const results = await Promise.all(
        createFileServiceDto.files.map(async (file) => {
          const filePath = this.constructFileName(file);
          const tagsQueryString = this.constructTagsQueryString(
            file.tags || {},
          );

          const url = await this.createPresignedUrl(
            filePath,
            file.contentType,
            tagsQueryString,
            createFileServiceDto.bucketName,
          );

          return { fileName: file.fileName, url, filePath };
        }),
      );

      this.logger.debug(
        `Presigned URLs generated for ${results.length} files.`,
      );

      return results;
    } catch (error) {
      this.logger.error(`Error generating URLs: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  async deleteFileFormS3(bucketName: string, key: string): Promise<any> {
    // Single query to get document mapping with document details using join

    const deleteResult = await this.s3.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );

    return deleteResult;
  }

  async getSignedUrlFromS3(
    bucket: string,
    key: string,
    expiresInSeconds = 604800,
  ): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const s3Client = new S3Client({
      region: process.env.AWS_REGION,
    });
    return await getSignedUrl(s3Client, cmd, { expiresIn: expiresInSeconds });
  }

  /**
   * Generates a pre-signed URL for an S3 object from its S3 URI.
   * @param s3Uri The S3 URI of the object (e.g., "s3://bucket-name/key").
   * @returns A promise that resolves to the pre-signed URL.
   * @throws {Error} If the URI protocol is not 's3:'.
   */
  async getSignedUrlFromS3Uri(s3Uri: string): Promise<string> {
    try {
      const url = new URL(s3Uri);
      if (url.protocol !== 's3:') {
        throw new BadRequestException(
          'Invalid S3 URI protocol. Must be "s3:".',
        );
      }
      const bucketName = url.hostname;
      const key = url.pathname.slice(1); // Remove leading '/'

      if (!bucketName || !key) {
        throw new BadRequestException(
          'Invalid S3 URI format. Could not extract bucket or key.',
        );
      }

      this.logger.debug(
        `Generating signed URL for bucket: ${bucketName}, key: ${key}`,
      );
      return this.getSignedUrlFromS3(key, bucketName);
    } catch (error) {
      this.logger.error(`Failed to parse S3 URI "${s3Uri}": ${error.message}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      // The URL constructor might throw a TypeError for malformed URLs
      throw new BadRequestException(`Invalid S3 URI format: ${s3Uri}`);
    }
  }

  async uploadProfileImage(
    key: string,
    body: Buffer,
    mimetype: string,
    bucketName: string,
  ): Promise<{ url: string }> {
    const params = {
      Bucket: bucketName,
      Key: key,
      Body: body,
      ACL: ObjectCannedACL.private,
      ContentType: mimetype,
      ContentDisposition: 'inline',
    };

    const command = new PutObjectCommand(params);
    const uploadProfileImage = await this.s3.send(command);
    if (uploadProfileImage.$metadata.httpStatusCode !== 200) {
      throw new Error('Failed to upload profile image');
    }
    // Generate a signed URL for the uploaded file
    const responseUrl = await this.getSignedUrlFromS3(params.Key, bucketName);

    // Return the result of the file upload
    return {
      url: responseUrl,
    };
  }

  async getVideoStream(key: string, bucketName: string): Promise<Readable> {
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    try {
      const response = await this.s3.send(getObjectCommand);
      if (!response.Body) {
        this.logger.warn(
          `S3 GetObject response body is empty for key: ${key} in bucket: ${bucketName}`,
        );
        throw new NotFoundException('Video stream not found or is empty.');
      }
      return response.Body as Readable;
    } catch (error) {
      this.logger.error(
        `Failed to get video stream for key ${key} in bucket ${bucketName}: ${error.message}`,
        error.stack,
      );
      if (error.name === 'NoSuchKey') {
        throw new NotFoundException('Video not found on S3.');
      }
      throw new InternalServerErrorException(
        `Failed to get video stream: ${error.message}`,
      );
    }
  }

  /**
   * Uploads a file (Buffer or Readable stream) to an S3 bucket.
   * Uses `@aws-sdk/lib-storage` for efficient handling of streams and large files (multipart upload).
   *
   * @param fileBufferOrStream The file content as a Buffer or a Readable stream.
   * @param fileName The original name of the file.
   * @param contentType The MIME type of the file (e.g., 'image/jpeg', 'video/mp4').
   * @param bucketName Optional. The name of the S3 bucket. Defaults to a constructed name
   *                   based on environment variables (`<APP_NAME>-<ENVIRONMENT>-media`).
   * @returns A Promise resolving to an object containing the S3 fileKey, bucketName, and the constructed URL.
   * @throws BadRequestException if the upload to S3 fails.
   */
  async uploadFileToS3(
    fileBufferOrStream: Buffer | Readable,
    fileName: string,
    contentType: string,
    bucketName: string = `${process.env.APP_NAME}-${process.env.ENVIRONMENT}-media`,
  ): Promise<{ fileKey: string; bucketName: string; url: string }> {
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `media/${uuidv4()}-${sanitizedFileName}`;

    try {
      const upload = new Upload({
        client: this.s3,
        params: {
          Bucket: bucketName,
          Key: fileKey,
          Body: fileBufferOrStream,
          ContentType: contentType,
        },
      });

      await upload.done();

      const url = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

      this.logger.log(`File uploaded successfully to S3: ${fileKey}`);
      return { fileKey, bucketName, url };
    } catch (error) {
      this.logger.error(
        `Error uploading file to S3: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Failed to upload file: ${error.message}`);
    }
  }
}
