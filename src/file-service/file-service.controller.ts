import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { FileServiceService } from './file-service.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UploadFileInS3Dto, UploadsSignedUrlQuery } from './dto/file.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('file')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('file-service')
export class FileServiceController {
  constructor(private readonly fileService: FileServiceService) {}

  @Post('/uploads')
  @ApiOperation({
    summary: 'Generate Presigned URLs',
    description: 'Generates presigned URLs for file uploads',
  })
  async generatePresignedUrls(
    @Body(ValidationPipe) createFileServiceDto: UploadFileInS3Dto,
  ) {
    return this.fileService.generatePresignedUrls(createFileServiceDto);
  }

  @Get('/presigned-url')
  @ApiOperation({
    summary: 'Legacy Generate Presigned URL',
    description:
      'Generates a single presigned URL for frontend backwards compatibility',
  })
  async getLegacyPresignedUrl(
    @Query('key') key: string,
    @Query('bucketName') bucketName?: string,
  ) {
    if (!key) {
      throw new BadRequestException('Key is required');
    }
    const result = await this.fileService.generatePresignedUrls({
      files: [{ fileName: key, contentType: 'application/octet-stream' }],
      bucketName: bucketName,
    });
    return { presignedUrl: result[0].url };
  }

  @Get('/file/signed-s3-url/generate')
  getSignedUrl(@Query() query: UploadsSignedUrlQuery): Promise<string> {
    return this.fileService.getSignedUrlFromS3(query.key, query.bucketName);
  }
}
