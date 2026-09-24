import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
  UseGuards,
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
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CommonService } from '../../common/service/common.service';
import { MediaPlaybackAuthorizationService } from '../services/media-playback-authorization.service';

@ApiTags('media-playback')
@Controller('media-playback')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MediaPlaybackController {
  constructor(
    private readonly playbackAuthService: MediaPlaybackAuthorizationService,
    @Optional()
    private readonly commonService?: CommonService,
  ) {}

  @Get(':recordingId/grant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get authorized playback grant for a recording',
    description:
      'Evaluates user entitlement and returns a cryptographically signed playback grant with HLS manifest URL.',
  })
  @ApiParam({
    name: 'recordingId',
    description: 'Recording UUID',
  })
  @ApiQuery({
    name: 'ttl',
    description: 'Token lifetime in seconds (optional, default 21600)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Playback grant issued successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden: User not entitled or payment required',
  })
  @ApiResponse({
    status: 404,
    description: 'Recording not found',
  })
  async getRecordingPlaybackGrant(
    @Req() req: Request,
    @Param('recordingId') recordingId: string,
    @Query('ttl') ttl?: string,
  ) {
    const userId = await this.resolveUserId(req);
    const ttlSeconds = ttl ? parseInt(ttl, 10) : undefined;

    const grant = await this.playbackAuthService.getRecordingPlaybackGrant(
      recordingId,
      userId,
      ttlSeconds,
    );

    return {
      success: true,
      data: grant,
      message: 'Playback grant issued successfully',
    };
  }

  @Get('highlight/:highlightId/grant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get authorized playback grant for a highlight clip',
    description:
      'Evaluates user entitlement and returns a cryptographically signed playback grant for the highlight clip.',
  })
  @ApiParam({
    name: 'highlightId',
    description: 'Highlight clip UUID',
  })
  @ApiQuery({
    name: 'ttl',
    description: 'Token lifetime in seconds (optional, default 21600)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Playback grant issued successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden: User not entitled or payment required',
  })
  @ApiResponse({
    status: 404,
    description: 'Highlight not found',
  })
  async getHighlightPlaybackGrant(
    @Req() req: Request,
    @Param('highlightId') highlightId: string,
    @Query('ttl') ttl?: string,
  ) {
    const userId = await this.resolveUserId(req);
    const ttlSeconds = ttl ? parseInt(ttl, 10) : undefined;

    const grant = await this.playbackAuthService.getHighlightPlaybackGrant(
      highlightId,
      userId,
      ttlSeconds,
    );

    return {
      success: true,
      data: grant,
      message: 'Highlight playback grant issued successfully',
    };
  }

  private async resolveUserId(req: Request): Promise<string> {
    const user = (req as any).user;
    if (user && (user.id || user.user_id)) {
      return user.id || user.user_id;
    }

    if (this.commonService) {
      try {
        const tokenData = await this.commonService.extractDataFromToken(req);
        return tokenData?.id || tokenData?.user_id || 'anonymous';
      } catch {
        // fallback
      }
    }

    return 'anonymous';
  }
}
