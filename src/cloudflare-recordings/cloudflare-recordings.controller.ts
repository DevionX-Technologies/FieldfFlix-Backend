import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../decorators/public.decorator';
import { CommonService } from '../common/service/common.service';
import { CloudflareRecordingsService } from './cloudflare-recordings.service';
import { CloudflareRecordingExtractDto } from './dto/cloudflare-recording-extract.dto';
import { CloudflareRecordingCallbackDto } from './dto/cloudflare-recording-callback.dto';

@ApiTags('Cloudflare Recordings')
@Controller('cloudflare-recordings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class CloudflareRecordingsController {
  constructor(
    private readonly recordingsService: CloudflareRecordingsService,
    private readonly commonService: CommonService,
  ) {}

  private async userId(req: Request): Promise<string> {
    const token = await this.commonService.extractDataFromToken(req);
    if (!token?.user_id) {
      throw new UnauthorizedException('User ID not found in token');
    }
    return token.user_id;
  }

  @Post('extract')
  @ApiOperation({ summary: 'Extract a recording directly to Cloudflare R2' })
  async extract(
    @Body(ValidationPipe) dto: CloudflareRecordingExtractDto,
    @Req() req: Request,
  ) {
    return this.recordingsService.extract(dto, await this.userId(req));
  }

  @Public()
  @Post('callback')
  @ApiOperation({
    summary: 'Verify an R2 recording upload and start Stream ingestion',
    description:
      'Called by the venue Pi. Requires headers `x-pi-timestamp` (unix seconds) and `x-pi-signature` (hex HMAC-SHA256 of `${timestamp}.${rawBody}` keyed by PI_CALLBACK_SECRET).',
  })
  async callback(
    @Body(ValidationPipe) dto: CloudflareRecordingCallbackDto,
    @Req() req: Request & { rawBody?: string },
    @Headers('x-pi-signature') signature?: string,
    @Headers('x-pi-timestamp') timestamp?: string,
  ) {
    return this.recordingsService.handleCallback(
      dto,
      req.rawBody ?? null,
      signature,
      timestamp,
    );
  }

  @Get(':id/playback')
  @ApiOperation({ summary: 'Get verified R2 or Cloudflare Stream playback' })
  async playback(@Param('id') id: string, @Req() req: Request) {
    return this.recordingsService.getPlayback(id, await this.userId(req));
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get the verified recording timeline' })
  async timeline(@Param('id') id: string, @Req() req: Request) {
    return this.recordingsService.getTimeline(id, await this.userId(req));
  }
}
