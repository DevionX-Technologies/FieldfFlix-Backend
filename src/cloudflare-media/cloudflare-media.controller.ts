import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
  Optional,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../decorators/public.decorator';
import { CommonService } from '../common/service/common.service';

import { CloudflareMediaService } from './cloudflare-media.service';
import { CloudflareExtractSessionDto } from './dto/cloudflare-extract.dto';
import { CloudflareCallbackDto } from './dto/cloudflare-callback.dto';
import { CloudflarePlaybackResponseDto } from './dto/cloudflare-playback.dto';
import {
  CloudflareStartLiveStreamDto,
  CloudflareStopLiveStreamDto,
} from './dto/cloudflare-live.dto';
import { CloudflareCreateClipDto } from './dto/cloudflare-clip.dto';

@ApiTags('Cloudflare Media')
@Controller('cloudflare')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class CloudflareMediaController {
  constructor(
    private readonly cfMediaService: CloudflareMediaService,
    @Optional()
    private readonly commonService?: CommonService,
  ) {}

  private async resolveUserId(req: Request): Promise<string | undefined> {
    const user = (req as any).user;
    if (user?.id || user?.user_id) return user.id || user.user_id;

    if (this.commonService) {
      try {
        const tokenData = await this.commonService.extractDataFromToken(req);
        return tokenData?.id || tokenData?.user_id;
      } catch {
        // fallback
      }
    }
    return undefined;
  }

  // =========================================================================
  // VOD / Recording Flow
  // =========================================================================

  @Post('media/extract-session')
  @ApiOperation({
    summary:
      'Request on-demand match video extraction directly to Cloudflare R2',
    description:
      'Provisions a Cloudflare R2 presigned PUT URL, commands the edge Raspberry Pi to extract NVR footage directly to R2, and registers the recording entity.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Extraction dispatched to Raspberry Pi and Cloudflare R2',
  })
  async extractSession(
    @Body(ValidationPipe) dto: CloudflareExtractSessionDto,
    @Req() req: Request,
  ) {
    const userId = await this.resolveUserId(req);
    return this.cfMediaService.extractSessionToR2(dto, userId);
  }

  @Public()
  @Post('media/callback')
  @ApiOperation({
    summary: 'Callback from Raspberry Pi on R2 upload completion',
    description:
      'Triggered when the venue edge device finishes uploading the MP4 to Cloudflare R2. Immediately marks video playable from R2, and in parallel initiates Cloudflare Stream VOD transcoding.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'R2 callback processed successfully',
  })
  async handleCallback(@Body(ValidationPipe) dto: CloudflareCallbackDto) {
    return this.cfMediaService.handleR2Callback(dto);
  }

  @Public()
  @Get('media/:id/playback')
  @ApiOperation({
    summary:
      'Dual playback URL resolver (R2 immediate + Cloudflare Stream adaptive HLS)',
    description:
      'Returns the active playback URL. While Cloudflare Stream is transcoding, delivers direct progressive MP4 from Cloudflare R2 (0 wait time). Once transcoding finishes, automatically upgrades to Cloudflare Stream multi-bitrate HLS.',
  })
  @ApiParam({ name: 'id', description: 'Recording UUID' })
  @ApiQuery({
    name: 'ttl',
    description: 'URL validity in seconds (default: 21600)',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Playback details resolved',
    type: CloudflarePlaybackResponseDto,
  })
  async getPlayback(
    @Param('id') recordingId: string,
    @Query('ttl') ttl?: string,
  ): Promise<CloudflarePlaybackResponseDto> {
    const ttlSeconds = ttl ? parseInt(ttl, 10) : 21600;
    return this.cfMediaService.getPlayback(recordingId, ttlSeconds);
  }

  @Public()
  @Get('media/:id/stream')
  @ApiOperation({
    summary: 'Instant redirect to active video stream',
    description:
      'HTTP 302 redirect directly to the active stream (R2 progressive MP4 while processing, Cloudflare Stream HLS once ready).',
  })
  @ApiParam({ name: 'id', description: 'Recording UUID' })
  async streamVideo(
    @Param('id') recordingId: string,
    @Res() res: Response,
  ): Promise<void> {
    const playback = await this.cfMediaService.getPlayback(recordingId);
    if (!playback.activeUrl) {
      res.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'No video media available for this recording yet',
      });
      return;
    }
    res.redirect(HttpStatus.FOUND, playback.activeUrl);
  }

  @Public()
  @Get('media/:id/sync')
  @ApiOperation({
    summary: 'Active sync with Cloudflare Stream API',
    description:
      'Actively checks Cloudflare Stream API to see if transcoding is complete and updates the database without waiting for webhooks.',
  })
  @ApiParam({ name: 'id', description: 'Recording UUID' })
  async syncStream(
    @Param('id') recordingId: string,
  ): Promise<CloudflarePlaybackResponseDto> {
    return this.cfMediaService.syncStreamStatus(recordingId);
  }

  @Post('media/clip')
  @ApiOperation({
    summary: 'Create highlight clip using Cloudflare Stream',
    description:
      'Creates a trimmed video clip directly on Cloudflare Stream using the parent video UID and time offsets.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Cloudflare highlight clip created',
  })
  async createClip(@Body(ValidationPipe) dto: CloudflareCreateClipDto) {
    return this.cfMediaService.createHighlightClip(dto);
  }

  // =========================================================================
  // Live Streaming Flow
  // =========================================================================

  @Public()
  @Post('live/start')
  @ApiOperation({
    summary: 'Start Cloudflare Live Stream for a court camera',
    description:
      'Provisions a Cloudflare Live Input, generates RTMPS credentials, commands the edge Raspberry Pi to relay the camera RTSP feed to Cloudflare, and registers the live stream.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cloudflare live stream started',
  })
  async startLive(@Body(ValidationPipe) dto: CloudflareStartLiveStreamDto) {
    return this.cfMediaService.startLiveStream(dto);
  }

  @Public()
  @Post('live/stop')
  @ApiOperation({
    summary: 'Stop an active Cloudflare Live Stream',
    description:
      'Signals the venue edge device to stop streaming and closes the Cloudflare Live Input.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cloudflare live stream stopped',
  })
  async stopLive(@Body(ValidationPipe) dto: CloudflareStopLiveStreamDto) {
    return this.cfMediaService.stopLiveStream(dto);
  }
}
