import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
  UnauthorizedException,
  Param,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommonService } from '../common/service/common.service';
import { ExtractionQueueService } from './extraction-queue.service';

export class QueueExtractionDto {
  @IsUUID()
  venueId: string;

  @IsUUID()
  cameraId: string;

  @IsInt()
  @Min(1)
  channelNumber: number;

  @IsDateString()
  startTime: string;

  @IsDateString()
  endTime: string;

  @IsString()
  piBaseUrl: string;

  @IsOptional()
  @IsString()
  piApiKey?: string;

  @IsOptional()
  @IsString()
  recordingName?: string;
}

@ApiTags('Extraction Queue')
@Controller('extraction-queue')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class ExtractionQueueController {
  constructor(
    private readonly queueService: ExtractionQueueService,
    private readonly commonService: CommonService,
  ) {}

  private async getUserId(req: Request): Promise<string> {
    const token = await this.commonService.extractDataFromToken(req);
    if (!token?.user_id)
      throw new UnauthorizedException('User ID not found in token');
    return token.user_id;
  }

  @Post('extract')
  @ApiOperation({ summary: 'Queue a new extraction (with deduplication)' })
  async queueExtraction(
    @Body(ValidationPipe) dto: QueueExtractionDto,
    @Req() req: Request,
  ) {
    const userId = await this.getUserId(req);
    return this.queueService.queueExtraction({
      userId,
      venueId: dto.venueId,
      cameraId: dto.cameraId,
      channelNumber: dto.channelNumber,
      startTime: new Date(dto.startTime),
      endTime: new Date(dto.endTime),
      piBaseUrl: dto.piBaseUrl,
      piApiKey: dto.piApiKey,
      recordingName: dto.recordingName,
    });
  }

  @Get('pipeline-status')
  @ApiOperation({
    summary:
      'Get the pipeline status for all user extractions with timing info',
  })
  async getPipelineStatus(@Req() req: Request) {
    const userId = await this.getUserId(req);
    return this.queueService.getPipelineStatus(userId);
  }

  @Get('job/:recordingId')
  @ApiOperation({
    summary: 'Get extraction job status for a specific recording',
  })
  async getJobStatus(
    @Param('recordingId') recordingId: string,
    @Req() req: Request,
  ) {
    await this.getUserId(req);
    const job = await this.queueService.getJobStatus(recordingId);
    if (!job) return { message: 'No job found for this recording.' };
    return job;
  }
}
