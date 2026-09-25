import {
  Body,
  Controller,
  Get,
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
  })
  async callback(@Body(ValidationPipe) dto: CloudflareRecordingCallbackDto) {
    return this.recordingsService.handleCallback(dto);
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
