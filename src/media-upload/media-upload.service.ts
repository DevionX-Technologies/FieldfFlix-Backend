import {
  HttpStatus,
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FileServiceService } from 'src/file-service/file-service.service';
import { MediaUploadEntity } from './entities/media-upload.entity';
import { DataSource, Repository } from 'typeorm';
import { EMediaUploadType, ESortOrder } from './enum/media-upload.enum';
import {
  CreateMediaUploadDto,
  DeleteUserMediaDto,
  QueryUserMediaDto,
} from './dto/media-upload.dto';
import { Express } from 'express';
import { HttpException } from '@nestjs/common';

@Injectable()
export class MediaUploadService {
  constructor(
    private readonly fileService: FileServiceService,
    @InjectRepository(MediaUploadEntity)
    private readonly mediaUploadRepository: Repository<MediaUploadEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async getVideoStream(mediaId: string): Promise<string | null> {
    const mediaUpload = await this.mediaUploadRepository.findOne({
      where: { id: mediaId, media_upload_type: EMediaUploadType.VIDEO },
    });

    if (!mediaUpload) {
      return null; // Controller will handle NotFoundException
    }

    if (!mediaUpload.media_url || !mediaUpload.bucket_name) {
      // Log this issue, as it indicates inconsistent data
      console.error(
        `Media record ${mediaId} is incomplete (missing media_url or bucket_name).`,
      );
      return null; // Controller will handle NotFoundException or treat as error
    }

    try {
      const presignedUrl = await this.fileService.getSignedUrlFromS3(
        mediaUpload.media_url, // This should be the S3 key
        mediaUpload.bucket_name,
      );
      return presignedUrl;
    } catch (error) {
      console.error(
        `Error generating presigned URL for media ${mediaId}: `,
        error,
      );
      // Re-throw or let controller handle null as not found / error
      // Depending on how FileServiceService.getSignedUrlFromS3 throws errors,
      // this might already be an HttpException. If not, wrap it.
      if (!(error instanceof HttpException)) {
        throw new InternalServerErrorException(
          `Failed to get video URL: ${error.message}`,
        );
      }
      throw error;
    }
  }

  async insertMediaUpload(
    mediaUpload: CreateMediaUploadDto,
  ): Promise<MediaUploadEntity> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const fileSizeBigInt = mediaUpload.file_size
        ? BigInt(mediaUpload.file_size)
        : null;

      const mediaUploadEntity = this.mediaUploadRepository.create({
        ...mediaUpload,
        file_size: fileSizeBigInt,
      });

      const savedMediaUpload =
        await queryRunner.manager.save(mediaUploadEntity);
      await queryRunner.commitTransaction();
      return savedMediaUpload;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getMediasByUser(
    userId: string,
    query: QueryUserMediaDto,
  ): Promise<MediaUploadEntity[]> {
    const { turfId, sortOrder, media_upload_type } = query;

    const qb = this.mediaUploadRepository.createQueryBuilder('media');

    qb.where('media.user_id = :user_id', { user_id: userId });

    if (turfId) {
      qb.andWhere('media.turf_id = :turfId', { turfId });
    }

    if (media_upload_type) {
      qb.andWhere('media.media_upload_type = :media_upload_type', {
        media_upload_type,
      });
    }

    if (sortOrder === ESortOrder.NEW_TO_OLD) {
      qb.orderBy('media.createdAt', 'DESC').addOrderBy('media.id', 'ASC');
    } else if (sortOrder === ESortOrder.OLD_TO_NEW) {
      qb.orderBy('media.createdAt', 'ASC').addOrderBy('media.id', 'DESC');
    } else {
      qb.orderBy('media.createdAt', 'DESC');
    }

    return qb.getMany();
  }

  async deleteUserMedia(
    userId: string,
    deleteUserMediaQuery: DeleteUserMediaDto[],
  ): Promise<{ message: string; status: HttpStatus }> {
    if (!deleteUserMediaQuery || deleteUserMediaQuery.length === 0) {
      throw new BadRequestException('Media IDs to delete are required.');
    }

    let deletedCount = 0;
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const mediaToDelete of deleteUserMediaQuery) {
        const { media_id } = mediaToDelete;

        const media = await queryRunner.manager.findOne(MediaUploadEntity, {
          where: { id: media_id, user_id: userId },
        });

        if (!media) {
          // Optionally log a warning if a requested media ID wasn't found for the user
          console.warn(
            `Media ID ${media_id} not found or does not belong to user ${userId}. Skipping deletion.`,
          );
          continue; // Skip to the next media ID
        }

        // Delete from S3 first
        if (media.media_url && media.bucket_name) {
          try {
            // Assuming media_url is the S3 key or extract key from it
            const s3Key = media.media_url; // Or extract key from media.media_url
            await this.fileService.deleteFileFormS3(s3Key, media.bucket_name);
            console.log(
              `Deleted S3 file: ${s3Key} from bucket ${media.bucket_name}`,
            );
          } catch (s3Error) {
            console.error(
              `Failed to delete S3 file ${media.media_url} from bucket ${media.bucket_name}: `,
              s3Error,
            );
            // Decide whether to throw or continue. Continuing might leave orphaned DB records.
            // For now, let's log and continue, assuming DB cleanup is more critical.
          }
        }

        // Delete from database
        await queryRunner.manager.delete(MediaUploadEntity, {
          id: media_id,
          user_id: userId,
        });
        deletedCount++;
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      console.error('Transaction failed during media deletion:', err);
      throw new InternalServerErrorException('Failed to delete media.');
    } finally {
      await queryRunner.release();
    }

    if (deletedCount === 0 && deleteUserMediaQuery.length > 0) {
      // This case should now be covered by the continue in the loop,
      // but this check remains as a safeguard if the input was non-empty but no matching records were found/deleted.
      // It might be better to refine the check or remove this throw if logging + continuing is sufficient.
      // For now, keeping it as per original logic if input had items but none were processed successfully.
      // A more precise check might be to compare deletedCount with the number of successfully found items before deletion attempt.
      console.warn(
        'Delete operation requested for items, but none were found or authorized for the user.',
      );
      throw new NotFoundException(
        'No matching media found to delete or not authorized.',
      );
    }

    return {
      message: `Successfully deleted ${deletedCount} media item(s).`,
      status: HttpStatus.OK,
    };
  }

  /**
   * Uploads a media file to an S3 bucket and creates a corresponding record in the database.
   *
   * @param file The file object from the request, processed by Multer.
   *             This object contains details like original name, mimetype, buffer, and size.
   * @param userId The ID of the user uploading the file.
   * @returns A Promise that resolves to the created MediaUploadEntity.
   * @throws BadRequestException if the file parameter is null or undefined.
   */
  async uploadMediaToS3(
    file: Express.Multer.File,
    userId: string,
  ): Promise<MediaUploadEntity> {
    if (!file) {
      throw new BadRequestException('File is required.');
    }

    const { originalname, mimetype, buffer, size } = file;

    const s3UploadResult = await this.fileService.uploadFileToS3(
      buffer,
      originalname,
      mimetype,
    );

    const mediaUploadDto: CreateMediaUploadDto = {
      user_id: userId,
      turf_id: null,
      media_url: s3UploadResult.fileKey,
      file_name: originalname,
      bucket_name: s3UploadResult.bucketName,
      content_type: mimetype,
      media_upload_type: this.determineMediaType(mimetype),
      file_size: String(size),
    };

    return this.insertMediaUpload(mediaUploadDto);
  }

  /**
   * Determines the EMediaUploadType based on the file's content type string.
   *
   * @param contentType The MIME type of the file (e.g., 'video/mp4', 'image/jpeg').
   * @returns The corresponding EMediaUploadType (VIDEO, IMAGE, or UNKNOWN).
   */
  private determineMediaType(contentType: string): EMediaUploadType {
    if (contentType.startsWith('video/')) {
      return EMediaUploadType.VIDEO;
    }
    if (contentType.startsWith('image/')) {
      return EMediaUploadType.IMAGE;
    }
    // Add more types as needed
    return EMediaUploadType.UNKNOWN; // Or throw an error for unsupported types
  }
}
