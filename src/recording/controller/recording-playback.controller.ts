import {
  Controller,
  Get,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { RecordingPaymentService } from '../service/recording-payment.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@ApiTags('recording-playback')
@Controller('recording-playback')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RecordingPlaybackController {
  constructor(
    private readonly recordingPaymentService: RecordingPaymentService,
  ) {}

  @Get(':recordingId/metadata')
  @ApiOperation({
    summary: 'Get recording metadata',
    description: 'Get recording metadata with payment information',
  })
  @ApiParam({
    name: 'recordingId',
    description: 'Recording ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Recording metadata retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Recording not found',
  })
  async getRecordingMetadata(
    @Req() req: Request,
    @Param('recordingId') recordingId: string,
  ) {
    try {
      const result = await this.recordingPaymentService.getRecordingMetadata(
        req,
        recordingId,
      );

      return {
        success: true,
        data: result,
        message: 'Recording metadata retrieved successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to get recording metadata',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
