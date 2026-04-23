import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { MuxService } from './mux.service';
import { CreateMuxUploadDto } from './dto/create-mux-upload.dto';
import { ApiKeyAuthGuard } from 'src/guards/api-key-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';

/**
 * Controller for handling Mux-related operations, such as video uploads.
 */
@ApiTags('Mux')
@Controller('mux')
export class MuxController {
  private readonly logger = new Logger(MuxController.name);

  constructor(private readonly muxService: MuxService) {}

  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ApiKeyAuthGuard)
  @ApiOperation({ summary: 'Starts a file upload from S3 to Mux' })
  @ApiHeader({
    name: 'x-api-key',
    description: 'API key for securing the endpoint',
    required: true,
  })
  @ApiResponse({ status: 202, description: 'Upload process started.' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  /**
   * Receives a request to upload a file from S3 to Mux.
   * This endpoint is protected by an API key.
   * It initiates the upload process asynchronously.
   * @param createMuxUploadDto The DTO containing the S3 URL, key, and recording ID.
   */
  async uploadFromS3(@Body() createMuxUploadDto: CreateMuxUploadDto) {
    this.logger.log(
      `Received request to upload from S3 for recordingId: ${createMuxUploadDto.recordingId}`,
    );
    this.muxService.uploadFromS3(
      createMuxUploadDto.s3Url,
      createMuxUploadDto.key,
      createMuxUploadDto.recordingId,
    );
    return { message: 'Upload process started.' };
  }
}
