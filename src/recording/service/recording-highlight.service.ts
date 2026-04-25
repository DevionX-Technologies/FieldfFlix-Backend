import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import axios, { AxiosResponse } from 'axios';
import { RecordingHighlights } from '../entities/recording-highlights.entity';
import { InjectDataSource } from '@nestjs/typeorm';
import { Recording } from 'src/recording/entities/recording.entity';
import { MuxService } from 'src/mux/mux.service';
import { parseRelativeTimestampToSeconds } from 'src/utils/utils';
import {
  DURATION_TO_BACKTRACK_SECONDS,
  MUX_API_BASE_URL,
  HIGHLIGHT_STATUS,
} from 'src/constant/constant';
import { ClipProcessingEnqueueService } from 'src/clip-processing/clip-processing.enqueue.service';
import { FireBaseNotificationService } from 'src/common/service/fire-base.service';
import { User } from 'src/user/entities/user.entity';
import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { MessageStatus, NotificationType } from 'src/constant/enum';

@Injectable()
export class RecordingHighlightsService {
  private readonly logger = new Logger(RecordingHighlightsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly muxService: MuxService,
    private readonly enqueueService: ClipProcessingEnqueueService,
    private readonly fireBaseNotificationService: FireBaseNotificationService,
  ) {}

  /**
   * Fires a `RECORDING_COMPLETE` push + DB notification once a Mux source asset becomes ready
   * (the recording is now playable in-app). Uses the same shape as `RECORDING_STOP` so the
   * mobile client can reuse its existing notification deep-link handler.
   */
  private async sendRecordingCompleteNotification(
    recordingId: string,
    userId: string,
    muxPlaybackId: string | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    try {
      const user = await queryRunner.manager.findOne(User, {
        where: { id: userId },
        relations: ['user_devices_token'],
      });

      if (!user || !user.user_devices_token?.length) return;

      const title = 'Your highlights are ready';
      const body = 'Tap to watch your match preview and saved highlights.';
      const dbData = [
        {
          recordingId,
          userId,
          mux_playback_id: muxPlaybackId,
          status: 'ready',
          completedAt: new Date(),
        },
      ];

      for (const deviceTokenObj of user.user_devices_token) {
        const token = deviceTokenObj.devices_id;
        await this.fireBaseNotificationService.sendNotification(
          {
            notification: { title, body },
            token,
            data: { click_action: 'RECORDING_COMPLETE' },
          },
          user.id,
        );
      }

      await queryRunner.manager.save(NotificationEntity, {
        user_id: user.id,
        title,
        body,
        data: dbData,
        message_status: MessageStatus.UNREAD,
        notification_type: NotificationType.RECORDING_COMPLETE,
        is_soft_delete: false,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send RECORDING_COMPLETE notification for ${recordingId}: ${err?.message || err}`,
      );
    }
  }

  /**
   * Formats seconds into HH:MM:SS or MM:SS format depending on duration
   * @param totalSeconds Total seconds to format
   * @returns Formatted time string (e.g., "3:02", "1:05:30", "2:45:15")
   */
  private formatRelativeTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    if (hours > 0) {
      // Format as HH:MM:SS for recordings over 1 hour
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      // Format as MM:SS for recordings under 1 hour
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  private calculateRelativeSeconds(
    recordingStartTime: Date,
    currentTime: Date,
  ): number {
    return Math.floor(
      (currentTime.getTime() - recordingStartTime.getTime()) / 1000,
    );
  }

  async createRecordingHighlight(
    recordingId: string,
  ): Promise<RecordingHighlights> {
    const queryRunner: QueryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const buttonClickTimestamp = new Date();
      const recording = await queryRunner.manager.findOne(Recording, {
        where: { raspberryPiRecordingId: recordingId },
        relations: ['recordingHighlights'],
      });

      if (!recording) {
        throw new HttpException(
          `Recording with Raspberry Pi Recording ID ${recordingId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (!recording.startTime) {
        throw new HttpException(
          'Recording start time not available',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Calculate relative time from recording start (how far into the video)
      const relativeSeconds = this.calculateRelativeSeconds(
        recording.startTime,
        buttonClickTimestamp,
      );

      this.logger.log(
        `Recording started at: ${recording.startTime.toISOString()}`,
        {
          recordingId: recording.id,
          recordingStartTime: recording.startTime,
        },
      );

      this.logger.log(
        `Highlight button clicked at: ${buttonClickTimestamp.toISOString()}`,
        {
          recordingId: recording.id,
          buttonClickTime: buttonClickTimestamp,
        },
      );

      this.logger.log(
        `Time elapsed since recording started: ${relativeSeconds} seconds`,
        {
          recordingId: recording.id,
          relativeSeconds,
          explanation:
            'This is how far into the video the highlight was created',
        },
      );

      // Ensure the highlight is at least 5 seconds after recording started
      if (relativeSeconds < 5) {
        throw new HttpException(
          'Highlight must be created at least 5 seconds after recording start',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Check 30-second gap requirement between highlights
      if (recording.recordingHighlights.length > 0) {
        const latestTimestamp = recording.recordingHighlights.sort(
          (a, b) =>
            new Date(b.button_click_timestamp).getTime() -
            new Date(a.button_click_timestamp).getTime(),
        )[0];

        const timeSinceLastHighlight = Math.floor(
          (buttonClickTimestamp.getTime() -
            new Date(latestTimestamp.button_click_timestamp).getTime()) /
          1000,
        );

        if (timeSinceLastHighlight < 30) {
          const lastHighlightRelativeTime =
            latestTimestamp.button_click_timestamp || 'unknown';
          throw new HttpException(
            `Highlight must be at least 30 seconds after the previous highlight. Last highlight was at ${lastHighlightRelativeTime}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // Format relative time as MM:SS (video position, not clock time)
      const relativeTimestamp = this.formatRelativeTime(relativeSeconds);

      this.logger.log(
        `Creating highlight at video position ${relativeTimestamp} (${relativeSeconds}s into the video)`,
        {
          recordingId: recording.id,
          raspberryPiRecordingId: recordingId,
          relativeTimestamp,
          relativeSeconds,
          isLongRecording: relativeSeconds >= 3600, // Over 1 hour
          explanation: `User clicked highlight ${relativeSeconds} seconds after recording started. This is "${relativeTimestamp}" into the video.`,
          formatExample:
            relativeSeconds >= 3600
              ? `Long recording: formatted as HH:MM:SS (${relativeTimestamp})`
              : `Short recording: formatted as MM:SS (${relativeTimestamp})`,
        },
      );

      // Assign processing_order: MAX(processing_order) + 1 for this recording
      const maxOrderResult = await queryRunner.query(
        `SELECT COALESCE(MAX(processing_order), 0) AS max_order
         FROM recording_highlights
         WHERE recording_id = $1`,
        [recording.id],
      );
      const processingOrder = parseInt(maxOrderResult[0].max_order, 10) + 1;

      // Determine initial status: if recording is already ready with mux_asset_id, go straight to pending
      const initialStatus = HIGHLIGHT_STATUS.PENDING;

      const recordingHighlight = await queryRunner.manager.save(
        RecordingHighlights,
        {
          recordingId: recording.id,
          button_click_timestamp: buttonClickTimestamp,
          relative_timestamp: relativeTimestamp,
          status: initialStatus,
          mux_public_playback_url: null,
          playback_id: null,
          asset_id: null,
          source_asset_id: recording?.mux_asset_id || null,
          failed_message: null,
          processing_order: processingOrder,
        },
      );

      this.logger.log(
        `Successfully created highlight at video position ${relativeTimestamp}`,
        {
          recordingHighlightId: recordingHighlight.id,
          relativeTimestamp,
          videoPosition: `${relativeTimestamp} (${relativeSeconds}s into the video)`,
          totalHighlights: recording.recordingHighlights.length + 1,
          processingOrder,
        },
      );

      await queryRunner.commitTransaction();

      // If the recording is already ready (mux_asset_id exists and isVideoCreated),
      // enqueue the recording for clip processing
      if (recording.mux_asset_id && recording.isVideoCreated) {
        this.logger.log(
          `Recording already ready, enqueuing recording ${recording.id} for clip processing`,
        );

        const updateRunner = this.dataSource.createQueryRunner();
        await updateRunner.connect();
        try {
          await updateRunner.query(
            `UPDATE recording_highlights SET status = $1, updated_at = NOW() WHERE id = $2`,
            [HIGHLIGHT_STATUS.QUEUED, recordingHighlight.id],
          );
          await this.enqueueService.enqueueRecording(
            recording.id,
            'single_highlight',
          );
        } finally {
          await updateRunner.release();
        }
      }

      return recordingHighlight;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async createVideoClip(
    recordingHighlightId: string,
    queryRunner: QueryRunner,
  ): Promise<{
    success: boolean;
    recordingHighlightId: string;
    message: string;
  }> {
    // Helper to format error messages and reduce code duplication
    const handleError = (message: string, status: HttpStatus) => {
      this.logger.error(message, {
        recordingHighlightId,
      });
      throw new HttpException(message, status);
    };

    // Defensive: Validate input types early
    if (!recordingHighlightId || typeof recordingHighlightId !== 'string') {
      this.logger.error(
        `Invalid recordingHighlightId: ${recordingHighlightId}`,
        {
          recordingHighlightId,
        },
      );
      handleError('Invalid recordingHighlightId', HttpStatus.BAD_REQUEST);
    }

    // Fetch the RecordingTimestamps entity with its associated Recording and all timestamps
    const recordingHighlight = await queryRunner.manager.findOne(
      RecordingHighlights,
      {
        where: { id: recordingHighlightId },
        relations: ['recording', 'recording.recordingHighlights'],
      },
    );

    if (!recordingHighlight) {
      this.logger.error(
        `RecordingHighlight with ID ${recordingHighlightId} not found`,
        {
          recordingHighlightId,
        },
      );
      handleError(
        `RecordingHighlight with ID ${recordingHighlightId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    // CRITICAL: Only create new clip if BOTH conditions are false
    // If clip already created OR has asset_id, check Mux status and update instead
    if (recordingHighlight.isClipCreated || recordingHighlight.asset_id) {
      this.logger.log(
        `Highlight ${recordingHighlightId} has existing asset, checking Mux status`,
        {
          recordingHighlightId,
          isClipCreated: recordingHighlight.isClipCreated,
          existingAssetId: recordingHighlight.asset_id,
        },
      );

      // Check Mux asset status and update highlight
      const updateResult = await this.checkAndUpdateExistingClip(
        recordingHighlight,
        queryRunner,
      );

      return {
        success: updateResult.success,
        recordingHighlightId,
        message: updateResult.message,
      };
    }

    const recording = recordingHighlight.recording;
    if (!recording) {
      this.logger.error(
        `Associated recording not found for RecordingHighlight ID ${recordingHighlightId}`,
        {
          recordingHighlightId,
        },
      );
      handleError(
        `Associated recording not found for RecordingHighlight ID ${recordingHighlightId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (!recording.mux_asset_id) {
      this.logger.error(`Recording does not have a Mux asset ID`, {
        recordingHighlightId,
      });
      handleError(
        'Recording does not have a Mux asset ID',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Get the relative timestamp from the highlight record
    if (!recordingHighlight.relative_timestamp) {
      this.logger.error(
        `No relative timestamp found for RecordingHighlight ID ${recordingHighlightId}`,
        { recordingHighlightId },
      );
      handleError(
        'No relative timestamp available for creating clip',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Parse the relative timestamp (e.g., "3:02" or "1:05:30") to get seconds
    const highlightTimeInSeconds = parseRelativeTimestampToSeconds(
      recordingHighlight.relative_timestamp,
    );

    this.logger.log(
      `Parsed relative timestamp: ${recordingHighlight.relative_timestamp} = ${highlightTimeInSeconds} seconds`,
      {
        recordingHighlightId,
        relativeTimestamp: recordingHighlight.relative_timestamp,
        highlightTimeInSeconds,
      },
    );

    const clipDuration = DURATION_TO_BACKTRACK_SECONDS;
    const endTime = highlightTimeInSeconds; // Highlight moment is the end point
    let startTime = Math.max(0, highlightTimeInSeconds - clipDuration);

    if (startTime < 0) {
      this.logger.warn(
        `Calculated startTime (${startTime}s) is negative, adjusting to 0`,
        {
          recordingHighlightId,
          originalStartTime: startTime,
          highlightTimeInSeconds,
          clipDuration,
        },
      );
      startTime = 0;
    }

    // Validate that we have a valid recording timeframe
    if (!recordingHighlight.recording.startTime) {
      this.logger.error(`Recording startTime is not available for validation`, {
        recordingHighlightId,
      });
      handleError(
        'Recording startTime not available for clip validation',
        HttpStatus.BAD_REQUEST,
      );
    }

    const actualClipDuration = endTime - startTime;

    this.logger.log(
      `Creating ${actualClipDuration}s clip ending at highlight moment`,
      {
        recordingHighlightId,
        highlightTimeInSeconds,
        relativeTimestamp: recordingHighlight.relative_timestamp,
        clipStartTime: startTime,
        clipEndTime: endTime,
        actualClipDuration,
        explanation:
          actualClipDuration < clipDuration
            ? `Highlight too early - showing ${actualClipDuration}s from start to highlight`
            : `Full ${clipDuration}s clip before highlight moment`,
      },
    );

    this.logger.log(`Recording start time: ${new Date(recording.startTime)}`, {
      recordingHighlightId,
    });
    this.logger.log(
      `Highlight position in video: ${highlightTimeInSeconds}s (${recordingHighlight.relative_timestamp})`,
      {
        recordingHighlightId,
        highlightTimeInSeconds,
        relativeTimestamp: recordingHighlight.relative_timestamp,
      },
    );
    this.logger.log(`Clip start time (relative to recording): ${startTime}s`, {
      recordingHighlightId,
    });
    this.logger.log(`Clip end time (relative to recording): ${endTime}s`, {
      recordingHighlightId,
    });
    this.logger.log(`Final clip duration: ${actualClipDuration}s`, {
      recordingHighlightId,
    });

    let muxResponse: any;
    try {
      muxResponse = await this.createMuxClip(
        recording.mux_asset_id,
        startTime,
        endTime,
      );
    } catch (error) {
      // Increment retryCount on failure
      const currentRetryCount = recordingHighlight.retryCount || 0;
      const newRetryCount = currentRetryCount + 1;

      await queryRunner.manager.update(
        RecordingHighlights,
        { id: recordingHighlightId },
        {
          status: HIGHLIGHT_STATUS.FAILED,
          mux_public_playback_url: null,
          playback_id: null,
          asset_id: null,
          failed_message:
            error?.response?.data?.error?.message ||
            error.message ||
            'Unknown error',
          source_asset_id: recording.mux_asset_id,
          isClipCreated: false, // Don't mark as created if it failed
          retryCount: newRetryCount,
        },
      );

      this.logger.warn(
        `Clip creation failed, retryCount incremented to ${newRetryCount}`,
        {
          recordingHighlightId,
          retryCount: newRetryCount,
          maxRetries: 2,
        },
      );
      this.logger.error(
        `Mux API Error: ${error?.response?.data?.error?.message || error.message}`,
        {
          recordingHighlightId,
          relativeTimestamp: recordingHighlight.relative_timestamp,
          highlightTimeInSeconds,
        },
      );
      handleError(
        `Mux API Error: ${error?.response?.data?.error?.message || error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!muxResponse || muxResponse.status !== 201) {
      // Increment retryCount on failure
      const currentRetryCount = recordingHighlight.retryCount || 0;
      const newRetryCount = currentRetryCount + 1;

      await queryRunner.manager.update(
        RecordingHighlights,
        { id: recordingHighlightId },
        {
          status: muxResponse?.data?.status || HIGHLIGHT_STATUS.FAILED,
          mux_public_playback_url: null,
          playback_id: null,
          asset_id: null,
          failed_message: muxResponse?.data?.error?.message || 'Unknown error',
          source_asset_id: recording.mux_asset_id,
          isClipCreated: false, // Don't mark as created if it failed
          retryCount: newRetryCount,
        },
      );

      this.logger.warn(
        `Clip creation failed (non-201 status), retryCount incremented to ${newRetryCount}`,
        {
          recordingHighlightId,
          retryCount: newRetryCount,
          maxRetries: 2,
          muxResponseStatus: muxResponse?.status,
        },
      );
      this.logger.error(
        `Failed to create video clip: ${muxResponse?.data?.error?.message || 'Unknown error'}`,
        {
          recordingHighlightId,
          relativeTimestamp: recordingHighlight.relative_timestamp,
          highlightTimeInSeconds,
        },
      );
      return {
        success: false,
        recordingHighlightId,
        message: `Failed to create video clip: ${muxResponse?.data?.error?.message || 'Unknown error'}`,
      };
    }

    const playbackId = Array.isArray(muxResponse.data?.data?.playback_ids)
      ? muxResponse.data.data.playback_ids.find(
        (p: any) => p?.policy === 'public',
      )?.id
      : null;

    // Set isClipCreated = true and reset retryCount to 0 on success
    await queryRunner.manager.update(
      RecordingHighlights,
      { id: recordingHighlightId },
      {
        status: muxResponse.data.data.status || 'preparing',
        mux_public_playback_url: null,
        asset_id: muxResponse.data.data.id,
        playback_id: playbackId,
        source_asset_id: recording.mux_asset_id,
        isClipCreated: true,
        retryCount: 0, // Reset retry count on success
      },
    );

    this.logger.log(
      `Video clip created successfully. Mux Asset ID: ${muxResponse.data.data.id}`,
      {
        recordingHighlightId,
        relativeTimestamp: recordingHighlight.relative_timestamp,
        highlightTimeInSeconds,
        clipStartTime: startTime,
        clipEndTime: endTime,
        clipDuration: actualClipDuration,
        clipType:
          actualClipDuration < clipDuration
            ? 'shortened (early highlight)'
            : `full ${clipDuration}s before`,
        isClipCreated: true,
      },
    );
    return {
      success: true,
      recordingHighlightId,
      message: `Video clip created successfully. Mux Asset ID: ${muxResponse.data.data.id}`,
    };
  }

  private async createMuxClip(
    muxAssetId: string,
    startTime: number,
    endTime: number,
  ): Promise<AxiosResponse> {
    this.logger.log(`Creating Mux clip`, {
      muxAssetId,
      startTime,
      endTime,
    });
    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    if (!muxTokenId || !muxTokenSecret) {
      this.logger.error(`Mux credentials not configured`, {
        muxAssetId,
        startTime,
        endTime,
      });
      throw new HttpException(
        'Mux credentials not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const requestBody = {
      input: [
        {
          url: `mux://assets/${muxAssetId}`,
          start_time: startTime,
          end_time: endTime,
        },
      ],
      playback_policy: ['public'],
      video_quality: 'basic',
    };

    const config = {
      method: 'POST',
      url: `${MUX_API_BASE_URL}/video/v1/assets`,
      headers: {
        'Content-Type': 'application/json',
      },
      auth: {
        username: muxTokenId,
        password: muxTokenSecret,
      },
      data: requestBody,
    };

    return await this.makeMuxApiCall(config, muxAssetId);
  }

  /**
   * Makes a direct Mux API call without retries
   */
  private async makeMuxApiCall(
    config: any,
    identifier: string,
  ): Promise<AxiosResponse> {
    this.logger.log(`Making Mux API call`, {
      identifier,
      url: config.url,
    });

    try {
      const response = await axios(config);

      this.logger.log(`Mux API call successful`, {
        identifier,
        status: response.status,
      });

      return response;
    } catch (error) {
      this.logger.error(`Mux API call failed`, {
        identifier,
        status: error?.response?.status,
        error: error?.response?.data || error?.message,
      });

      throw error;
    }
  }

  /**
   * Utility method to create a delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check Mux asset status for existing clip and update highlight accordingly
   */
  private async checkAndUpdateExistingClip(
    recordingHighlight: RecordingHighlights,
    queryRunner: QueryRunner,
  ): Promise<{ success: boolean; message: string }> {
    const assetId = recordingHighlight.asset_id;

    if (!assetId) {
      this.logger.log(
        `No asset_id found for highlight ${recordingHighlight.id}, cannot check Mux status`,
      );
      return {
        success: false,
        message: 'No asset_id to check Mux status',
      };
    }

    try {
      this.logger.log(`Checking Mux asset status for assetId: ${assetId}`);
      const assetStatus = await this.checkMuxAssetStatus(assetId);

      this.logger.log(`Mux asset status for ${assetId}:`, { assetStatus });

      if (assetStatus.status === 'ready') {
        // Asset is ready, update highlight to ready
        const playbackUrl = assetStatus.playback_id
          ? `https://stream.mux.com/${assetStatus.playback_id}.m3u8`
          : null;

        await queryRunner.manager.update(
          RecordingHighlights,
          { id: recordingHighlight.id },
          {
            status: HIGHLIGHT_STATUS.READY,
            mux_public_playback_url: playbackUrl,
            playback_id: assetStatus.playback_id,
            isClipCreated: true,
          },
        );

        this.logger.log(
          `Updated highlight ${recordingHighlight.id} to ready with playbackUrl: ${playbackUrl}`,
        );

        return {
          success: true,
          message: `Highlight updated to ready (Asset ID: ${assetId}, Playback URL: ${playbackUrl})`,
        };
      } else if (
        assetStatus.status === 'errored' ||
        assetStatus.status === 'failed'
      ) {
        // Asset failed in Mux, update highlight to failed
        await queryRunner.manager.update(
          RecordingHighlights,
          { id: recordingHighlight.id },
          {
            status: HIGHLIGHT_STATUS.FAILED,
            failed_message: `Mux asset ${assetStatus.status}: ${assetStatus.error || 'Unknown error'}`,
          },
        );

        this.logger.log(
          `Updated highlight ${recordingHighlight.id} to failed due to Mux asset error`,
        );

        return {
          success: false,
          message: `Mux asset failed: ${assetStatus.error || 'Unknown error'}`,
        };
      } else {
        // Asset still preparing
        this.logger.log(
          `Highlight ${recordingHighlight.id} asset still ${assetStatus.status}, no update needed`,
        );

        return {
          success: true,
          message: `Asset still ${assetStatus.status}, waiting for completion`,
        };
      }
    } catch (error) {
      this.logger.error(
        `Error checking Mux asset status for highlight ${recordingHighlight.id}:`,
        { error: error?.message || error },
      );

      // If we get a 404, the asset doesn't exist in Mux - need to recreate
      if (error?.response?.status === 404) {
        this.logger.log(
          `Asset ${assetId} not found in Mux, resetting highlight for recreation`,
        );

        // Reset the highlight so it can be recreated
        await queryRunner.manager.update(
          RecordingHighlights,
          { id: recordingHighlight.id },
          {
            status: HIGHLIGHT_STATUS.FAILED,
            asset_id: null,
            playback_id: null,
            mux_public_playback_url: null,
            isClipCreated: false,
            failed_message: 'Mux asset not found (404), needs recreation',
          },
        );

        return {
          success: false,
          message: 'Asset not found in Mux (404), reset for recreation',
        };
      }

      return {
        success: false,
        message: `Error checking Mux status: ${error?.message || String(error)}`,
      };
    }
  }

  /**
   * Check Mux asset status via API
   */
  private async checkMuxAssetStatus(assetId: string): Promise<{
    status: string;
    playback_id?: string;
    error?: string;
  }> {
    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    if (!muxTokenId || !muxTokenSecret) {
      throw new HttpException(
        'Mux credentials not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const config = {
      method: 'GET',
      url: `${MUX_API_BASE_URL}/video/v1/assets/${assetId}`,
      headers: {
        'Content-Type': 'application/json',
      },
      auth: {
        username: muxTokenId,
        password: muxTokenSecret,
      },
    };

    const response = await axios(config);
    const asset = response.data.data;
    const playbackId = Array.isArray(asset.playback_ids)
      ? asset.playback_ids.find((p: any) => p?.policy === 'public')?.id
      : null;

    return {
      status: asset.status,
      playback_id: playbackId,
      error: asset.errors?.[0]?.message,
    };
  }

  async handleMuxWebhook(webhookBody: any): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { type, data, environment } = webhookBody;
      const assetId: string = data?.id;

      this.logger.log(`Processing webhook event: ${type}`, {
        assetId,
        environment: environment?.name,
      });

      if (!assetId) {
        this.logger.error(`Missing asset ID in webhook payload`, {
          assetId,
          environment: environment?.name,
        });
        throw new HttpException(
          'Missing asset ID in webhook payload',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Webhook idempotency check
      const muxEventId = `${type}:${assetId}:${data?.status || 'unknown'}`;
      const idempotencyResult = await queryRunner.query(
        `INSERT INTO webhook_events (mux_event_id, event_type, asset_id, processed_at, response_status)
         VALUES ($1, $2, $3, NOW(), 'processing')
         ON CONFLICT (mux_event_id) DO NOTHING
         RETURNING id`,
        [muxEventId, type, assetId],
      );

      if (!idempotencyResult || idempotencyResult.length === 0) {
        this.logger.log(`Duplicate webhook event, skipping: ${muxEventId}`);
        await queryRunner.commitTransaction();
        return;
      }

      const webhookEventId = idempotencyResult[0].id;

      let recordingToEnqueue: { recordingId: string } | null = null;

      switch (type) {
        case 'video.asset.ready': {
          this.logger.log(`Handling video.asset.ready event`, {
            assetId,
            environment: environment?.name,
            playbackIds: data?.playback_ids,
          });
          recordingToEnqueue = await this.handleAssetReady(assetId, data, queryRunner);
          break;
        }

        case 'video.asset.errored': {
          this.logger.log(`Handling video.asset.errored event`, {
            assetId,
            environment: environment?.name,
          });
          await this.handleAssetErrored(assetId, data, queryRunner);
          break;
        }

        default:
          this.logger.warn(`Unhandled webhook event type: ${type}`, {
            assetId,
            environment: environment?.name,
          });
          break;
      }

      // Mark webhook event as processed
      await queryRunner.query(
        `UPDATE webhook_events SET response_status = 'processed' WHERE id = $1`,
        [webhookEventId],
      );

      await queryRunner.commitTransaction();
      this.logger.log(`Successfully processed webhook event: ${assetId}`, {
        eventType: type,
        assetId,
      });

      // Enqueue the recording to SQS AFTER transaction is committed
      if (recordingToEnqueue) {
        try {
          await this.enqueueService.enqueueRecording(
            recordingToEnqueue.recordingId,
            'webhook',
          );
        } catch (sqsError) {
          // Log but don't fail — the sweep will pick this up
          this.logger.error(
            `Failed to enqueue recording ${recordingToEnqueue.recordingId} to SQS`,
            { error: sqsError?.message },
          );
        }
      }
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      this.logger.error('Error handling Mux webhook', {
        error: error.message,
        stack: error.stack,
        webhookBody,
      });
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Handles video.asset.ready events
   * @param assetId The Mux asset ID
   * @param webhookData The full webhook data containing playback_ids
   * @param queryRunner The query runner for database operations
   */
  private async handleAssetReady(
    assetId: string,
    webhookData: any,
    queryRunner: QueryRunner,
  ): Promise<{ recordingId: string } | null> {
    this.logger.log(`Handling video.asset.ready event`, {
      assetId,
      webhookPlaybackIds: webhookData?.playback_ids,
    });

    // Extract playback_id from webhook data (more reliable than DB)
    const webhookPlaybackId = Array.isArray(webhookData?.playback_ids)
      ? webhookData.playback_ids.find((p: any) => p?.policy === 'public')?.id ||
      webhookData.playback_ids[0]?.id
      : null;

    // ────────────────────────────────────────────────────────────────────
    // CHECK HIGHLIGHT FIRST (optimized: clip webhooks are far more frequent)
    // For N highlights, clip webhooks fire N times vs recording webhook fires 1 time.
    // Checking highlights first avoids N unnecessary recording table queries.
    // ────────────────────────────────────────────────────────────────────
    const recordingHighlight = await queryRunner.manager.findOne(
      RecordingHighlights,
      { where: { asset_id: assetId } },
    );

    if (recordingHighlight) {
      // This is a CLIP asset becoming ready — most common case
      this.logger.log(
        `Found highlight clip for asset ${assetId}, updating to ready`,
        {
          recordingHighlightId: recordingHighlight.id,
          assetId,
        },
      );

      // Skip if already ready (idempotent)
      if (recordingHighlight.status === HIGHLIGHT_STATUS.READY) {
        this.logger.log(`Highlight ${recordingHighlight.id} already ready, skipping`);
        return null;
      }

      // Use playback_id from webhook data if available, otherwise use stored one
      const playbackId = webhookPlaybackId || recordingHighlight.playback_id;
      const playbackUrl = playbackId
        ? `https://stream.mux.com/${playbackId}.m3u8`
        : null;

      await queryRunner.manager.update(
        RecordingHighlights,
        { id: recordingHighlight.id },
        {
          status: HIGHLIGHT_STATUS.READY,
          playback_id: playbackId,
          mux_public_playback_url: playbackUrl,
        },
      );

      this.logger.log(
        `Updated RecordingHighlight to ready: ${recordingHighlight.id}`,
        {
          recordingHighlightId: recordingHighlight.id,
          playbackId,
          playbackUrl,
        },
      );

      return null;
    }

    // ────────────────────────────────────────────────────────────────────
    // NOT A CLIP — CHECK IF THIS IS A SOURCE RECORDING ASSET
    // This only fires once per recording (when the source video is ready)
    // ────────────────────────────────────────────────────────────────────
    const recording = await queryRunner.manager.findOne(Recording, {
      where: { mux_asset_id: assetId },
    });

    if (!recording) {
      this.logger.warn(
        `No highlight or recording found for asset ${assetId}, ignoring`,
        { assetId },
      );
      return null;
    }

    this.logger.log(
      `Found source recording for asset ${assetId}, enqueuing clips for SQS processing`,
      {
        recordingId: recording.id,
      },
    );

    // Update recording status, persist the playback id from the webhook (so the
    // app's list/highlight endpoints have a valid stream URL even if the upload
    // path didn't store one), and mark the video as created.
    const recordingUpdate: Partial<Recording> = {
      status: 'ready',
      isVideoCreated: true,
    };
    if (webhookPlaybackId && !recording.mux_playback_id) {
      recordingUpdate.mux_playback_id = webhookPlaybackId;
      recordingUpdate.mux_media_url = `https://stream.mux.com/${webhookPlaybackId}.m3u8`;
    }

    await queryRunner.manager.update(
      Recording,
      { id: recording.id },
      recordingUpdate,
    );

    this.logger.log(
      `Updated recording status to ready and isVideoCreated=true`,
      {
        recordingId: recording.id,
        persistedPlaybackId:
          recordingUpdate.mux_playback_id ?? '(already set)',
      },
    );

    // Notify the owner that the recording is now viewable in-app.
    // Use the playback id from the webhook (more reliable than the DB at this point).
    if (recording.userId) {
      await this.sendRecordingCompleteNotification(
        recording.id,
        recording.userId,
        webhookPlaybackId,
        queryRunner,
      );
    }

    // Find all pending highlights that need clip creation
    const pendingHighlights = await queryRunner.manager.find(
      RecordingHighlights,
      {
        where: {
          recordingId: recording.id,
          isClipCreated: false,
          asset_id: null,
        },
        order: { processing_order: 'ASC' },
      },
    );

    this.logger.log(
      `Found ${pendingHighlights.length} highlights to enqueue for clip creation`,
      {
        recordingId: recording.id,
        highlightsToEnqueue: pendingHighlights.length,
      },
    );

    await this.muxService.updateRecordingWithTimingFromAsset(
      recording.id,
      assetId,
    );

    // Set all pending highlights to 'queued'
    for (const highlight of pendingHighlights) {
      await queryRunner.manager.update(
        RecordingHighlights,
        { id: highlight.id },
        {
          status: HIGHLIGHT_STATUS.QUEUED,
          source_asset_id: recording.mux_asset_id,
        },
      );
    }

    // Re-order ALL processing_order by relative_timestamp (chronological order)
    await queryRunner.query(`
      WITH ordered AS (
        SELECT id, ROW_NUMBER() OVER (
          ORDER BY
            CASE
              WHEN array_length(string_to_array(relative_timestamp, ':'), 1) = 3 THEN
                (split_part(relative_timestamp, ':', 1)::int * 3600) +
                (split_part(relative_timestamp, ':', 2)::int * 60) +
                (split_part(relative_timestamp, ':', 3)::int)
              WHEN array_length(string_to_array(relative_timestamp, ':'), 1) = 2 THEN
                (split_part(relative_timestamp, ':', 1)::int * 60) +
                (split_part(relative_timestamp, ':', 2)::int)
              ELSE 0
            END ASC,
            created_at ASC
        ) AS new_order
        FROM recording_highlights
        WHERE recording_id = $1
          AND status NOT IN ($2, $3)
      )
      UPDATE recording_highlights rh
      SET processing_order = o.new_order
      FROM ordered o
      WHERE rh.id = o.id
    `, [recording.id, HIGHLIGHT_STATUS.PERMANENTLY_FAILED, HIGHLIGHT_STATUS.FAILED]);

    this.logger.log(
      `Completed setting highlights to queued and re-ordered by relative_timestamp for recording ${recording.id}`,
      {
        recordingId: recording.id,
        assetId,
        queuedCount: pendingHighlights.length,
      },
    );

    // Return recording to enqueue after transaction commits
    if (pendingHighlights.length > 0) {
      return { recordingId: recording.id };
    }

    return null;
  }

  /**
   * Handles video.asset.errored events
   */
  private async handleAssetErrored(
    assetId: string,
    data: any,
    queryRunner: QueryRunner,
  ): Promise<void> {
    const errorMessage =
      data?.errors?.[0]?.message || 'Asset processing failed';

    // First, check if the assetId belongs to a Recording
    const erroredRecording = await queryRunner.manager.findOne(Recording, {
      where: { mux_asset_id: assetId },
    });

    if (erroredRecording) {
      this.logger.error(`Recording asset errored: ${assetId}`, {
        errorMessage,
      });

      // Update the Recording table itself with failed status
      await queryRunner.manager.update(
        Recording,
        { id: erroredRecording.id },
        {
          status: 'failed',
          mux_asset_id: assetId || null,
          isVideoCreated: true,
          metadata: {
            ...erroredRecording.metadata,
            error: errorMessage,
            erroredAt: new Date().toISOString(),
          },
        },
      );

      // Mark all related RecordingHighlights as permanently_failed
      // Never auto-delete highlights — the user explicitly created them
      await queryRunner.manager.update(
        RecordingHighlights,
        { recordingId: erroredRecording.id },
        {
          status: HIGHLIGHT_STATUS.PERMANENTLY_FAILED,
          failed_message: `Source recording asset errored: ${errorMessage}`,
        },
      );
    } else {
      // If not found in Recording, check if the assetId is for a RecordingHighlight
      const erroredTimestamp = await queryRunner.manager.findOne(
        RecordingHighlights,
        {
          where: { asset_id: assetId },
        },
      );

      if (erroredTimestamp) {
        this.logger.error(`Clip asset errored: ${assetId}`, { errorMessage });
        await queryRunner.manager.update(
          RecordingHighlights,
          { id: erroredTimestamp.id },
          {
            status: 'errored',
            asset_id: assetId || null,
            failed_message: `Clip asset errored: ${errorMessage}`,
            retryCount: erroredTimestamp.retryCount + 1,
            isClipCreated: true,
          },
        );
      } else {
        this.logger.warn(
          `No Recording or RecordingHighlight found for errored asset ID ${assetId}`,
        );
      }
    }
  }

  async processAssetIdAndCreateVideoClips(
    recordingData: Recording,
    findHighlights: RecordingHighlights[],
    queryRunner: QueryRunner,
  ): Promise<{
    success: boolean;
    results: any[];
    errors: any[];
    processedCount: number;
    totalCount: number;
    source: 'recording_table' | 'timestamp_table' | 'none';
  }> {
    this.logger.log(`Processing asset ID and creating video clips`, {
      recordingId: recordingData.id,
    });

    // Defensive: If no timestamps, return early
    const timestamps = findHighlights;

    this.logger.log(`Timestamps analysis`, {
      totalHighlights: timestamps.length,
      eligibleForClipCreation: timestamps.length,
      timestamps,
    });

    const totalCount = timestamps.length;
    this.logger.log(`Total timestamps to process: ${totalCount}`, {
      totalCount,
    });

    if (totalCount === 0) {
      return {
        success: true,
        results: [],
        errors: [],
        processedCount: 0,
        totalCount: 0,
        source: 'recording_table',
      };
    }

    const CONCURRENCY_LIMIT = 1;
    const successResults: any[] = [];
    const errorResults: any[] = [];

    const processBatch = async (batch: typeof timestamps) => {
      // Process sequentially with 3-second delay between each createVideoClip call
      for (const highlight of batch) {
        try {
          this.logger.log(`Processing video clip`, {
            recordingHighlightId: highlight.id,
            relativeTimestamp: highlight.relative_timestamp,
            buttonClickTimestamp: highlight.button_click_timestamp,
          });

          const result = await this.createVideoClip(highlight.id, queryRunner);

          this.logger.log(`Video clip created successfully`, {
            recordingHighlightId: highlight.id,
            success: result.success,
          });
          successResults.push({
            recordingHighlightId: highlight.id,
            success: true,
            result,
          });
        } catch (error) {
          this.logger.error(`Error processing video clip`, {
            recordingHighlightId: highlight.id,
            error: error?.message || String(error),
          });
          errorResults.push({
            recordingHighlightId: highlight.id,
            error: error?.message || String(error),
          });
        }

        // Add 3-second delay before processing next highlight (except for the last one in batch)
        if (highlight !== batch[batch.length - 1]) {
          this.logger.log(`Waiting 3 seconds before processing next clip...`);
          await this.delay(3000);
        }
      }
    };

    try {
      // Process in batches to control memory and resource usage
      for (let i = 0; i < totalCount; i += CONCURRENCY_LIMIT) {
        const batch = timestamps.slice(i, i + CONCURRENCY_LIMIT);
        // eslint-disable-next-line no-await-in-loop
        await processBatch(batch);
      }

      return {
        success: errorResults.length === 0,
        results: successResults,
        errors: errorResults,
        processedCount: successResults.length,
        totalCount,
        source: 'recording_table',
      };
    } catch (error) {
      // Defensive: catch-all for unexpected errors
      throw error instanceof HttpException
        ? error
        : new HttpException(
          `Failed to process asset ID ${recordingData.id}: ${error?.message || String(error)}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
    }
  }

  async addBulkRecordingHighlights(
    recordingId: string,
    source_asset_id: string,
    // data: [{
    //   buttonClickTimestamp: Date,
    //   relativeTimestamp: string,
    // }],
    data: [{
      relativeTimestamp: string,
      mux_public_playback_url: string,
      playback_id: string,
      asset_id: string,

    }],
  ): Promise<any> {
    const queryRunner: QueryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {

      for (const item of data) {
        // const recordingHighlight = await queryRunner.manager.save(RecordingHighlights, {
        //   recordingId: recordingId,
        //   button_click_timestamp: item.buttonClickTimestamp,
        //   relative_timestamp: item.relativeTimestamp,
        //   status: 'ready',
        // });

        // console.log(recordingHighlight);

        await queryRunner.manager.update(RecordingHighlights, { recordingId: recordingId, relative_timestamp: item.relativeTimestamp }, {
          source_asset_id: source_asset_id,
          asset_id: item.asset_id,
          mux_public_playback_url: item.mux_public_playback_url,
          playback_id: item.playback_id,
          status: 'ready',
          isClipCreated: true,
        });
      }

      await queryRunner.commitTransaction();
      return "recordingHighlights";
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
