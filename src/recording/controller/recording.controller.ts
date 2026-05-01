import {
  Controller,
  Post,
  Body,
  Param,
  Put,
  Patch,
  ValidationPipe,
  HttpStatus,
  Get,
  NotFoundException,
  Res,
  StreamableFile,
  HttpCode,
  Logger,
  Req,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { FileServiceService } from '../../file-service/file-service.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeaders,
  ApiBody,
} from '@nestjs/swagger';
import { StartRecordingDto } from '../dto/start-recording.dto';
import { StopRecordingDto } from '../dto/stop-recording.dto';
import { Recording } from '../entities/recording.entity';
import { Public } from 'src/decorators/public.decorator';
import { CommonService } from 'src/common/service/common.service';
import { ConfigService } from '@nestjs/config';
import { QueryUserMediaDto } from 'src/media-upload/dto/media-upload.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CreateSharedRecordingDto } from '../dto/create-shared-recording.dto';
import { UpdateRecordingNameDto } from '../dto/update-recording-name.dto';
import { SharedRecording } from '../entities/shared-recording.entity';
import { SharedRecordingResponseDto } from '../dto/shared-recording-response.dto';
import { RecordingHighlightsService } from '../service/recording-highlight.service';
import { RecordingService } from '../service/recording.service';
import { RecordingHighlightEngagementService } from '../service/recording-highlight-engagement.service';
import { MuxService } from '../../mux/mux.service';

/**
 * Controller for handling recording-related requests.
 */
@ApiTags('recording')
@Controller('recording')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class RecordingController {
  private readonly logger = new Logger(RecordingController.name);
  private readonly uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;


  constructor(
    private readonly recordingService: RecordingService,
    private readonly fileServiceService: FileServiceService,
    private readonly commonService: CommonService,
    private readonly configService: ConfigService,
    private readonly recordingHighlightsService: RecordingHighlightsService,
    private readonly muxService: MuxService,
    private readonly recordingHighlightEngagementService: RecordingHighlightEngagementService,
  ) { }

  /**
   * Handles the request to start a new recording.
   *
   * @param startRecordingDto The DTO containing recording details.
   * @returns A confirmation message or the created recording details.
   */
  @Post('/start')
  @ApiOperation({ summary: 'Start a new recording' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Recording started successfully',
    type: Recording,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Recording already in progress for the camera',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Camera not found',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to start recording',
  })
  async startRecording(
    @Body(ValidationPipe) startRecordingDto: StartRecordingDto,
  ) {
    // Placeholder logic
    console.log('Start recording requested', startRecordingDto);
    // Call service method to start recording
    return this.recordingService.startRecording(startRecordingDto);
  }

  /**
   * Handles the request to stop an ongoing recording.
   *
   * @param recordingId The ID of the recording to stop.
   * @param stopRecordingDto The DTO containing stop recording details (if any).
   * @returns A confirmation message or the updated recording details.
   */
  @Put('/stop/:id')
  @ApiOperation({ summary: 'Stop an ongoing recording' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recording stopped successfully',
    type: Recording,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Recording not found or not in progress',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description:
      'Failed to stop recording or Raspberry Pi recording ID missing',
  })
  async stopRecording(
    @Param('id') recordingId: string,
    @Body(ValidationPipe) _stopRecordingDto: StopRecordingDto, // eslint-disable-line @typescript-eslint/no-unused-vars
  ) {
    // Placeholder logic
    console.log('Stop recording requested for ID', recordingId);
    // Call service method to stop recording
    return this.recordingService.stopRecording(recordingId);
  }

  /**
   * Retrieves all recordings owned by the authenticated user.
   * Requires Bearer token authentication.
   *
   * @param req The Express request object, used to extract user ID.
   * @returns A Promise resolving to an array of Recording.
   */
  @ApiOperation({ summary: 'Get all recordings owned by the user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved user recordings',
    type: [Recording],
  })
  @Get('my-recordings')
  async getMyRecordings(@Req() req: Request): Promise<Recording[]> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    if (!user_id) {
      throw new UnauthorizedException('User ID not found in token');
    }
    return this.recordingService.getMyRecordings(user_id);
  }

  /**
   * Retrieves all recordings shared with the authenticated user.
   * Requires Bearer token authentication.
   *
   * @param req The Express request object, used to extract user ID.
   * @returns A Promise resolving to an array of SharedRecording.
   */
  @ApiOperation({ summary: 'Get all recordings shared with the user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved shared recordings',
    type: [SharedRecordingResponseDto],
  })
  @Get('shared-with-me')
  async getSharedRecordings(
    @Req() req: Request,
  ): Promise<SharedRecordingResponseDto[]> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.recordingService.getSharedRecordings(user_id);
  }

  @ApiOperation({ summary: 'Get all recordings shared by the user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved recordings shared by current user',
  })
  @Get('shared-by-me')
  async getRecordingsSharedByMe(@Req() req: Request) {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.recordingService.getRecordingsSharedByMe(user_id);
  }

  /**
   * Get or create a shared recording for the current user.
   * If the user already has access to the recording via a shared record, returns it.
   * Otherwise, creates a new shared recording entry and returns it.
   *
   * @param recordingId The ID of the recording to access.
   * @param req The Express request object, used to extract user ID from JWT token.
   * @returns A Promise resolving to the SharedRecording entity.
   * @throws NotFoundException if the recording does not exist.
   * @throws UnauthorizedException if user ID is not found in token.
   */
  @ApiOperation({
    summary: 'Get or create shared recording access for current user',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved or created shared recording access',
    type: SharedRecording,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Recording not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User ID not found in token',
  })
  @Get('shared/:recordingId')
  async getOrCreateSharedRecording(
    @Param('recordingId') recordingId: string,
    @Req() req: Request,
  ): Promise<SharedRecording> {
    const { user_id } = await this.commonService.extractDataFromToken(req);

    if (!user_id) {
      throw new UnauthorizedException('User ID not found in token');
    }

    return this.recordingService.getOrCreateSharedRecording(
      recordingId,
      user_id,
    );
  }

  /**
   * Get the current status of a recording.
   * Useful for polling after calling stop recording.
   *
   * @param recordingId The ID of the recording.
   * @returns Current status and details of the recording.
   * @throws NotFoundException if the recording is not found.
   */
  @Get(':id/status')
  @ApiOperation({ summary: 'Get recording status (for polling)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recording status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: {
          type: 'string',
          enum: ['in_progress', 'processing', 'completed', 'failed'],
        },
        s3Path: { type: 'string' },
        mux_playback_id: { type: 'string' },
        startTime: { type: 'string', format: 'date-time' },
        endTime: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Recording not found',
  })
  async getRecordingStatus(@Param('id') recordingId: string) {
    return this.recordingService.getRecordingStatus(recordingId);
  }

  /**
   * Retrieves a recording by its ID.
   *
   * @param recordingId The ID of the recording to retrieve.
   * @returns The Recording entity with relations.
   * @throws NotFoundException if the recording is not found.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get recording by ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recording found',
    type: Recording,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Recording not found',
  })
  async getRecordingById(@Param('id') recordingId: string) {
    const recording = await this.recordingService.getRecordingById(recordingId);

    if (!recording) {
      throw new NotFoundException(`Recording with ID ${recordingId} not found`);
    }

    const muxUrlData = await this.recordingService.getMuxPublicUrl(recordingId);
    const publicMuxUrl = muxUrlData ? muxUrlData.publicUrl : null;

    return { ...recording, mux_public_url: publicMuxUrl };
  }

  /**
   * Updates the display name of a recording (owner only).
   *
   * @param id The ID of the recording to update.
   * @param updateRecordingNameDto The new recording name.
   * @param req The request (for user ID from token).
   * @returns The updated Recording entity.
   * @throws NotFoundException if the recording is not found.
   * @throws ForbiddenException if the user does not own the recording.
   */
  @Patch(':id/name')
  @ApiOperation({ summary: 'Update recording name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recording name updated successfully',
    type: Recording,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Recording not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User does not own the recording',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized',
  })
  async updateRecordingName(
    @Param('id') id: string,
    @Body(ValidationPipe) updateRecordingNameDto: UpdateRecordingNameDto,
    @Req() req: Request,
  ): Promise<Recording> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    if (!user_id) {
      throw new UnauthorizedException('User ID not found in token');
    }
    return this.recordingService.updateRecordingName(
      id,
      user_id,
      updateRecordingNameDto.recording_name,
    );
  }

  /**
   * Streams the video file for a recording from S3.
   *
   * @param recordingId The ID of the recording.
   * @param res The response object for streaming.
   * @returns A streamable file.
   * @throws NotFoundException if the recording is not found.
   * @throws InternalServerErrorException if the S3 path is not available or streaming fails.
   */
  @Get(':id/stream')
  @ApiOperation({ summary: 'Stream video for a recording' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Video stream started' })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Recording not found',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'S3 path not available or streaming failed',
  })
  async streamRecording(
    @Param('id') recordingId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const s3Key = await this.recordingService.getRecordingS3Path(recordingId);
    // Construct bucket name based on FileServiceService pattern
    const bucketName = `${process.env.APP_NAME}-${process.env.ENVIRONMENT}-media`;

    // Get the video stream from FileServiceService
    const videoStream = await this.fileServiceService.getVideoStream(
      s3Key,
      bucketName,
    );

    // Set headers for video streaming (adjust content type as needed)
    // Note: In a real scenario, you might want to get content type from S3 object metadata
    res.set({
      'Content-Type': 'video/mp4', // Or appropriate video type
      'Content-Disposition': `inline; filename="recording-${recordingId}.mp4"`, // Suggest filename
    });

    return new StreamableFile(videoStream);
  }

  /**
   * Resolves a share token to a viewer-friendly recording payload.
   * Public — anyone with the link can land on the in-app Highlights screen and see the
   * 2.5-minute preview. Full playback is gated by the user's plan in the mobile client.
   * If a JWT happens to be present we also stamp a `SharedRecording` row for the viewer.
   */
  @Public()
  @ApiOperation({
    summary: 'Resolve a share token (Public)',
    description:
      'Returns the recording metadata required to render the Highlights screen for a shared link. Anonymous-friendly — the app gates full playback by entitlement client-side.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Shared recording resolved successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Shared media not found or token is invalid.',
    type: NotFoundException,
  })
  @Get('shared/media/:share_token')
  @HttpCode(HttpStatus.OK)
  async streamSharedVideo(
    @Req() req: Request,
    @Param('share_token') shareTokenParam: string,
  ): Promise<{
    recording_id: string | null;
    owner_id: string | null;
    mux_playback_id: string | null;
    mux_media_url: string | null;
    duration_seconds: number | null;
    start_time: Date | null;
    end_time: Date | null;
    turf_name: string | null;
    owner_name: string | null;
    status: string | null;
    presignedUrl: string | null;
  }> {
    const actualShareToken = shareTokenParam;

    // The endpoint is public, but a JWT may still be present (logged-in viewer).
    let viewerUserId: string | null = null;
    try {
      const tokenData = await this.commonService.extractDataFromToken(req);
      viewerUserId = tokenData?.user_id ?? null;
    } catch {
      viewerUserId = null;
    }

    const resolved = await this.recordingService.resolveShareToken(
      actualShareToken,
      viewerUserId,
    );

    if (!resolved) {
      throw new NotFoundException(
        'Shared media not found or token is invalid.',
      );
    }

    return {
      ...resolved,
      // Backwards compatibility with the previous shape used by older app builds.
      presignedUrl: resolved.mux_media_url,
    };
  }

  @Get('highlights/saved')
  @ApiOperation({ summary: 'List saved recording highlights for the current user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Saved highlights returned' })
  async listSavedRecordingHighlights(@Req() req: Request) {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.recordingHighlightEngagementService.listSavedSummaries(user_id);
  }

  @Post('highlights/:highlightId/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle like on a recording highlight' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Like toggled' })
  async toggleRecordingHighlightLike(
    @Param('highlightId') highlightId: string,
    @Req() req: Request,
  ) {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.recordingHighlightEngagementService.toggleLike(
      user_id,
      highlightId,
    );
  }

  @Post('highlights/:highlightId/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle save on a recording highlight' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Save toggled' })
  async toggleRecordingHighlightSave(
    @Param('highlightId') highlightId: string,
    @Req() req: Request,
  ) {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.recordingHighlightEngagementService.toggleSave(
      user_id,
      highlightId,
    );
  }

  /**
   * Returns the list of READY highlights for a recording, shaped for the mobile
   * Highlights screen. Auto-generation of highlights is NOT performed here — this
   * endpoint surfaces what the existing button-press + clip-processing pipeline produced.
   */
  @Public()
  @Get(':id/highlights')
  @ApiOperation({ summary: 'List ready highlights for a recording' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Highlights returned' })
  async getRecordingHighlights(
    @Param('id') recordingId: string,
    @Req() req: Request,
  ) {
    let viewerUserId: string | null = null;
    try {
      const t = await this.commonService.extractDataFromToken(req);
      viewerUserId = t?.user_id ?? null;
    } catch {
      viewerUserId = null;
    }
    return this.recordingService.getReadyHighlightsForRecording(
      recordingId,
      viewerUserId,
    );
  }

  /**
   * Returns a fresh signed Mux playback token + URL for a recording, suitable for
   * in-app playback of recordings whose Mux assets are configured with a `signed`
   * playback policy. Falls back to the existing public URL for older "public" assets.
   */
  @Get(':id/playback')
  @ApiOperation({ summary: 'Get a playback token / URL for a recording' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Playback URL returned' })
  async getRecordingPlayback(@Param('id') recordingId: string) {
    const recording = await this.recordingService.getRecordingById(recordingId);
    if (!recording) {
      throw new NotFoundException(`Recording with ID ${recordingId} not found`);
    }

    const playbackId = recording.mux_playback_id;
    if (!playbackId) {
      return {
        recording_id: recording.id,
        playback_id: null,
        mux_public_url: null,
        signed_token: null,
        signed_url: null,
        expires_at: null,
      };
    }

    const signed = await this.muxService.signPlaybackToken(playbackId);
    const publicUrl = `https://stream.mux.com/${playbackId}.m3u8`;
    return {
      recording_id: recording.id,
      playback_id: playbackId,
      mux_public_url: publicUrl,
      signed_token: signed?.token ?? null,
      signed_url: signed?.token
        ? `${publicUrl}?token=${encodeURIComponent(signed.token)}`
        : publicUrl,
      expires_at: signed?.expires_at ?? null,
    };
  }

  /**
   * Generates a shareable link for a specific video.
   * Requires Bearer token authentication. The user must own the video.
   *
   * @param mediaId The ID of the media item (must be a video) to share.
   * @param req The Express request object, used to extract user ID.
   * @returns A Promise resolving to an object containing the shareableLink.
   * @throws NotFoundException if the media is not found.
   * @throws ForbiddenException if the user is not authorized to share this media or if it's not a video.
   * @throws UnauthorizedException if token is invalid or missing.
   */
  @ApiOperation({
    summary: 'Generate a shareable link for a video (Protected)',
  })
  @ApiBearerAuth('access-token')
  @ApiResponse({
    status: HttpStatus.OK, // Should be 200 OK as it returns data, or 201 if a new share resource is always created
    description: 'Shareable link generated successfully.',
    schema: {
      type: 'object',
      properties: { shareableLink: { type: 'string' } },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Media not found.',
    type: NotFoundException,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User not authorized or media is not a video.',
    type: ForbiddenException,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized access.',
    type: UnauthorizedException,
  })
  @Post(':mediaId/share')
  @HttpCode(HttpStatus.OK)
  async generateShareLink(
    @Param('mediaId') mediaIdParam: string,
    @Req() req: Request,
  ): Promise<{ shareableLink: string }> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    const actualMediaId = this._parseMediaId(mediaIdParam);

    const { share_token } = await this.recordingService.generateShareLink(
      actualMediaId,
      user_id,
    );

    // Public origin that serves `GET /shared/media/:token` (SharedMediaRootController).
    // Prefer `APP_BASE_URL` in env; if unset (misconfigured deploy), use production API
    // so links are not silently wrong.
    const rawBase =
      this.configService.get<string>('APP_BASE_URL')?.trim() ||
      'https://api.devionx.com';
    const appBaseUrl = rawBase.replace(/\/+$/, '');
    const shareableLink = `${appBaseUrl}/shared/media/${share_token}`;

    return { shareableLink };
  }

  /**
   * Toggles the favorite status of a specific video for the authenticated user.
   * Requires Bearer token authentication.
   *
   * @param mediaId The ID of the media item (must be a video).
   * @param req The Express request object, used to extract user ID.
   * @returns A Promise resolving to the updated Recording.
   * @throws NotFoundException if the media is not found.
   * @throws ForbiddenException if the user is not authorized or if the media is not a video.
   * @throws UnauthorizedException if token is invalid or missing.
   */
  @ApiOperation({ summary: 'Toggle favorite status of a video (Protected)' })
  @ApiBearerAuth('access-token')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Favorite status toggled successfully.',
    type: Recording,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Media not found.',
    type: NotFoundException,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User not authorized or media is not a video.',
    type: ForbiddenException,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized access.',
    type: UnauthorizedException,
  })
  @Post(':mediaId/favorite')
  @HttpCode(HttpStatus.OK)
  async toggleFavorite(
    @Param('mediaId') mediaId: string,
    @Req() req: Request,
  ): Promise<Recording> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.recordingService.toggleFavoriteStatus(mediaId, user_id);
  }

  /**
   * Retrieves a list of favorite media items for the authenticated user.
   * Requires Bearer token authentication.
   *
   * @param query Query parameters for filtering (turfId), sorting (sortOrder), and type (media_upload_type).
   * @param req The Express request object, used to extract user ID.
   * @returns A Promise resolving to an array of Recording.
   * @throws UnauthorizedException if token is invalid or missing.
   */
  @ApiOperation({ summary: "Get user's favorite videos (Protected)" })
  @ApiBearerAuth('access-token')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved user favorite media.',
    type: [Recording], // Indicates an array of Recording
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
  @Get('favorites/medias')
  async getFavoriteVideos(
    @Query(ValidationPipe) query: QueryUserMediaDto,
    @Req() req: Request,
  ): Promise<Recording[]> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.recordingService.getFavoriteVideos(user_id, query);
  }


  @ApiOperation({ summary: 'Share a recording with another user' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Recording shared successfully',
    type: SharedRecording,
  })
  @Post('share')
  async createSharedRecording(
    @Body(ValidationPipe) createSharedRecordingDto: CreateSharedRecordingDto,
    @Req() req: Request,
  ): Promise<SharedRecording> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.recordingService.createSharedRecording(
      createSharedRecordingDto,
      user_id,
    );
  }

  private _parseMediaId(mediaIdParam: string): string {
    if (mediaIdParam.toLowerCase().startsWith('http')) {
      let potentialIdFromUrl: string;
      try {
        const url = new URL(mediaIdParam);
        const pathParts = url.pathname.split('/');
        potentialIdFromUrl = pathParts[pathParts.length - 1];
      } catch (e) {
        this.logger.warn(
          `Error parsing mediaIdParam '${mediaIdParam}' as URL: ${e.message}`,
        );
        throw new BadRequestException('Invalid media ID URL format.');
      }

      if (this.uuidRegex.test(potentialIdFromUrl)) {
        this.logger.debug(
          `Extracted mediaId '${potentialIdFromUrl}' from URL '${mediaIdParam}'`,
        );
        return potentialIdFromUrl;
      } else {
        this.logger.warn(
          `Path segment '${potentialIdFromUrl}' from URL '${mediaIdParam}' is not a valid UUID.`,
        );
        throw new BadRequestException(
          'Media ID in URL path is not a valid UUID.',
        );
      }
    }

    if (mediaIdParam.includes('%')) {
      let decodedId: string;
      try {
        decodedId = decodeURIComponent(mediaIdParam);
      } catch (e) {
        this.logger.warn(
          `Error decoding mediaIdParam '${mediaIdParam}': ${e.message}`,
        );
        throw new BadRequestException('Error decoding media ID.');
      }

      if (this.uuidRegex.test(decodedId)) {
        this.logger.debug(
          `Decoded mediaId '${decodedId}' from '${mediaIdParam}'`,
        );
        return decodedId;
      } else {
        this.logger.warn(
          `Decoded mediaId '${decodedId}' from '${mediaIdParam}' is not a UUID.`,
        );
        throw new BadRequestException('Decoded media ID is not a valid UUID.');
      }
    }

    if (this.uuidRegex.test(mediaIdParam)) {
      return mediaIdParam;
    }

    this.logger.warn(
      `Invalid mediaId format: '${mediaIdParam}'. Expected UUID.`,
    );
    throw new BadRequestException('Invalid media ID format. Expected UUID.');
  }

  @Public()
  @ApiHeaders([
    {
      name: 'x-client-id',
      description: 'Mux signature for webhook verification',
      required: true,
    },
  ])
  @Post(':recordingId/highlight')
  @HttpCode(200)
  async createRecordingHighlight(
    @Req() req: Request,
    @Param('recordingId') recordingId: string,
  ) {
    const clientId = req.headers['x-client-id'] as string;
    if (!clientId || clientId !== process.env.RPI_CLIENT_ID) {
      throw new BadRequestException('Client ID is required');
    }
    return await this.recordingHighlightsService.createRecordingHighlight(
      recordingId,
    );
  }

  /**
   * Processes a highlight by converting M3U8 to MP4 using Lambda function.
   * Requires Bearer token authentication.
   *
   * @param highlightId The ID of the highlight to process.
   * @param req The Express request object, used to extract user ID.
   * @returns A Promise resolving to the processed highlight result.
   * @throws NotFoundException if the highlight is not found.
   * @throws ForbiddenException if the user is not authorized to process this highlight.
   * @throws UnauthorizedException if token is invalid or missing.
   */
  @ApiOperation({
    summary: 'Process highlight by converting M3U8 to MP4 (Protected)',
  })
  @ApiBearerAuth('access-token')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Highlight processed successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        highlightId: { type: 'string' },
        s3Path: { type: 'string' },
        bucketName: { type: 'string' },
        signedUrl: { type: 'string' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Highlight not found.',
    type: NotFoundException,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User not authorized to process this highlight.',
    type: ForbiddenException,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized access.',
    type: UnauthorizedException,
  })
  @Post('highlight/:highlightId/process')
  @HttpCode(HttpStatus.OK)
  async processHighlight(
    @Param('highlightId') highlightId: string,
    @Req() req: Request,
  ): Promise<{
    success: boolean;
    highlightId: string;
    s3Path?: string;
    bucketName?: string;
    signedUrl?: string;
    message: string;
  }> {
    const { user_id } = await this.commonService.extractDataFromToken(req);
    return this.recordingService.processHighlight(highlightId, user_id);
  }

  @Public()
  @Post(':recordingId/add-bulk-recording-highlights')
  @ApiBody({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          relativeTimestamp: { type: 'string' },
          mux_public_playback_url: { type: 'string' },
          playback_id: { type: 'string' },
          asset_id: { type: 'string' },
        },
      },
    },
  })
  async addBulkRecordingHighlights(
    @Param('recordingId') recordingId: string,
    @Body('source_asset_id') source_asset_id: string,
    @Body(ValidationPipe) data: [{
      relativeTimestamp: string,
      mux_public_playback_url: string,
      playback_id: string,
      asset_id: string,
    }],
  ) {
    return this.recordingHighlightsService.addBulkRecordingHighlights(recordingId, source_asset_id, data);
  }
}
