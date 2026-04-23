import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  ValidationPipe,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UnauthorizedException,
  ClassSerializerInterceptor,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { MediaUploadService } from './media-upload.service';
import { Request } from 'express';
import { DeleteUserMediaDto, QueryUserMediaDto } from './dto/media-upload.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiBody,
  ApiConsumes,
  ApiResponse,
} from '@nestjs/swagger';
import { CommonService } from 'src/common/service/common.service';
import { ConfigService } from '@nestjs/config';
import { MediaUploadEntity } from './entities/media-upload.entity';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('media')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
@UseInterceptors(ClassSerializerInterceptor)
export class MediaUploadController {
  private readonly logger = new Logger(MediaUploadController.name);

  constructor(
    private readonly mediaUploadService: MediaUploadService,
    private readonly commonService: CommonService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Uploads a media file to S3 and creates a corresponding media record.
   * The file is expected as part of a multipart/form-data request.
   * Requires Bearer token authentication.
   *
   * @param file The uploaded file object, processed by Multer.
   * @param req The Express request object, used to extract user ID from token.
   * @returns A Promise resolving to the created MediaUploadEntity.
   * @throws BadRequestException if no file is provided.
   * @throws UnauthorizedException if token is invalid or missing.
   */
  @ApiOperation({ summary: 'Upload a new media file to S3 (Protected)' })
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Media file to upload. Max file size: 100MB (configurable in Multer setup - not shown here).',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'The media file to upload.',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Media uploaded and record created successfully.',
    type: MediaUploadEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Bad request, e.g., no file provided or invalid file type.',
    type: BadRequestException,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized access.',
  })
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadMedia(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ): Promise<MediaUploadEntity> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.mediaUploadService.uploadMediaToS3(file, user_id);
  }

  /**
   * Streams a video file by its media ID.
   * Requires Bearer token authentication.
   *
   * @param mediaId The ID of the media to stream.
   * @returns A JSON object with the presigned URL.
   * @throws NotFoundException if the video is not found or access is denied.
   * @throws UnauthorizedException if token is invalid or missing.
   */
  @ApiOperation({
    summary: 'Get presigned URL for video by media ID (Protected)',
  })
  @ApiBearerAuth('access-token')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the S3 presigned URL for the video.',
    schema: {
      type: 'object',
      properties: { presignedUrl: { type: 'string' } },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Video not found or access denied.',
    type: NotFoundException,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized access.',
    type: UnauthorizedException,
  })
  @Get('stream/media/:mediaId')
  @HttpCode(HttpStatus.OK)
  async streamVideo(
    @Param('mediaId') mediaId: string,
  ): Promise<{ presignedUrl: string }> {
    const presignedUrl = await this.mediaUploadService.getVideoStream(mediaId);
    if (!presignedUrl) {
      this.logger.warn(`No presigned URL found for mediaId: ${mediaId}`);
      throw new NotFoundException('Video not found or access denied.');
    }
    return { presignedUrl };
  }

  /**
   * Retrieves a list of media items uploaded by the authenticated user.
   * Supports pagination and sorting.
   * Requires Bearer token authentication.
   *
   * @param query Query parameters for filtering (turfId), sorting (sortOrder), and type (media_upload_type).
   * @param req The Express request object, used to extract user ID.
   * @returns A Promise resolving to an array of MediaUploadEntity.
   * @throws UnauthorizedException if token is invalid or missing.
   */
  @ApiOperation({ summary: 'Get medias by user (Protected)' })
  @ApiBearerAuth('access-token')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved user media.',
    type: [MediaUploadEntity], // Indicates an array of MediaUploadEntity
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters.',
    type: BadRequestException,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized access.',
    type: UnauthorizedException,
  })
  @Get('user/medias')
  async getMediasByUser(
    @Query(ValidationPipe) query: QueryUserMediaDto,
    @Req() req: Request,
  ) {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.mediaUploadService.getMediasByUser(user_id, query);
  }

  /**
   * Deletes one or more media items belonging to the authenticated user.
   * Requires Bearer token authentication.
   *
   * @param req The Express request object, used to extract user ID.
   * @param deleteUserMediaDtos An array of DTOs, each containing a media_id to delete.
   * @returns A Promise resolving to an object with a success message and status.
   * @throws NotFoundException if no matching media is found to delete for any of the provided IDs (and at least one ID was provided).
   * @throws UnauthorizedException if token is invalid or missing.
   */
  @ApiOperation({ summary: 'Delete user media items (Protected)' })
  @ApiBearerAuth('access-token')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Media item(s) deleted successfully.',
    schema: {
      type: 'object',
      properties: { message: { type: 'string' }, status: { type: 'number' } },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request body or missing media IDs.',
    type: BadRequestException,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No matching media found to delete or not authorized.',
    type: NotFoundException,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to delete media due to a server error.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized access.',
    type: UnauthorizedException,
  })
  @Delete('user/medias')
  @HttpCode(HttpStatus.OK)
  async deleteUserMedia(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    deleteUserMediaDtos: DeleteUserMediaDto[],
  ): Promise<{ message: string; status: number }> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.mediaUploadService.deleteUserMedia(
      user_id,
      deleteUserMediaDtos,
    );
  }
}
