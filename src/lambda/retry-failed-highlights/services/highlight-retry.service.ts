import { DataSource, QueryRunner } from 'typeorm';
import axios, { AxiosResponse } from 'axios';
import {
  DURATION_TO_BACKTRACK_SECONDS,
  MUX_API_BASE_URL,
} from 'src/constant/constant';
import { parseRelativeTimestampToSeconds } from '../utils/lambda.util';

export interface MuxAssetStatus {
  status: string;
  playback_id?: string;
  error?: string;
}

export interface VideoClipResult {
  success: boolean;
  recordingHighlightId: string;
  message: string;
}

export interface HighlightProcessingResult {
  success: boolean;
  highlightId: string;
  recordingId: string;
  result?: any;
  error?: string;
}

// Raw SQL result interfaces
export interface RecordingHighlightRow {
  id: string;
  recordingId: string;
  buttonClickTimestamp: Date;
  relativeTimestamp?: string;
  sourceAssetId?: string;
  assetId?: string;
  status?: string;
  failedMessage?: string;
  playbackId?: string;
  muxPublicPlaybackUrl?: string;
  bucketName?: string;
  s3path?: string;
  metadata?: {
    retryCount?: number;
    lastRetryAttempt?: string;
    retryHistory?: Array<{
      attempt: number;
      timestamp: string;
      previousStatus: string;
      previousErrorMessage: string;
    }>;
    permanentlyFailed?: boolean;
    permanentlyFailedAt?: string;
    finalError?: any;
  };
  /**
   * Flag indicating if clip has been created in Mux.
   * Used to prevent duplicate clip creation.
   */
  isClipCreated?: boolean;
  /**
   * Number of times clip creation has been retried.
   * Max retries: 2
   */
  retryCount?: number;
  createdAt: Date;
  updatedAt: Date;
  recording_id: string;
  userId: string;
  cameraId: string;
  startTime: Date;
  endTime?: Date;
  s3Path?: string;
  recordingStatus: string;
  muxAssetId?: string;
  muxPlaybackId?: string;
  muxMediaUrl?: string;
}

/**
 * Service for handling highlight retry business logic
 * Each function has a single responsibility
 */
export class HighlightRetryService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Check the status of a Mux asset
   */
  async checkMuxAssetStatus(assetId: string): Promise<MuxAssetStatus> {
    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    if (!muxTokenId || !muxTokenSecret) {
      console.log('checkMuxAssetStatus: Mux credentials not configured');
      throw new Error('Mux credentials not configured');
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

    try {
      console.log('checkMuxAssetStatus: About to call axios', {
        assetId,
        url: config.url,
      });
      const response = await axios(config);
      const asset = response.data.data;
      const playbackId = Array.isArray(asset.playback_ids)
        ? asset.playback_ids.find((p: any) => p?.policy === 'public')?.id
        : null;

      console.log('checkMuxAssetStatus: API call success', {
        assetId,
        status: asset.status,
      });

      return {
        status: asset.status,
        playback_id: playbackId,
        error: asset.errors?.[0]?.message,
      };
    } catch (error) {
      console.error(`Error checking Mux asset status: ${error.message}`, {
        assetId,
        error: error?.response?.data || error?.message,
      });
      throw error;
    }
  }

  /**
   * Create a Mux video clip
   */
  async createMuxClip(
    muxAssetId: string,
    startTime: number,
    endTime: number,
  ): Promise<AxiosResponse> {
    console.log(`Creating Mux clip`, {
      muxAssetId,
      startTime,
      endTime,
    });

    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    if (!muxTokenId || !muxTokenSecret) {
      console.error(`Mux credentials not configured`, {
        muxAssetId,
        startTime,
        endTime,
      });
      throw new Error('Mux credentials not configured');
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

    console.log('createMuxClip: Prepared requestBody', requestBody);

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
   * Make Mux API call
   */
  async makeMuxApiCall(
    config: any,
    identifier: string,
  ): Promise<AxiosResponse> {
    console.log(`Making Mux API call`, {
      identifier,
      url: config.url,
    });

    try {
      const response = await axios(config);

      console.log(`Mux API call successful`, {
        identifier,
        status: response.status,
      });

      return response;
    } catch (error) {
      console.error(`Mux API call failed`, {
        identifier,
        status: error?.response?.status,
        error: error?.response?.data || error?.message,
      });

      throw error;
    }
  }

  /**
   * Create a video clip for a recording highlight
   */
  async createVideoClip(
    recordingHighlightId: string,
    queryRunner: QueryRunner,
  ): Promise<VideoClipResult> {
    console.log('createVideoClip: Called', { recordingHighlightId });
    this.validateRecordingHighlightId(recordingHighlightId);

    const recordingHighlight = await this.getRecordingHighlight(
      recordingHighlightId,
      queryRunner,
    );

    console.log('createVideoClip: got recordingHighlight', {
      recordingHighlight,
      isClipCreated: recordingHighlight.isClipCreated,
      hasAssetId: !!recordingHighlight.assetId,
    });

    if (recordingHighlight.isClipCreated || recordingHighlight.assetId) {
      console.log(
        `Highlight ${recordingHighlightId} has existing asset, checking Mux status`,
        {
          recordingHighlightId,
          isClipCreated: recordingHighlight.isClipCreated,
          existingAssetId: recordingHighlight.assetId,
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

    // Validate that the recording has a Mux asset ID (from the joined recording table)
    if (!recordingHighlight.muxAssetId) {
      console.error(
        `Recording does not have a Mux asset ID for highlight ${recordingHighlightId}`,
        {
          recordingHighlightId,
          recordingId: recordingHighlight.recordingId,
        },
      );
      throw new Error('Recording does not have a Mux asset ID');
    }

    const recording = recordingHighlight; // Use the highlight row which contains muxAssetId from join

    this.validateRelativeTimestamp(recordingHighlight, recordingHighlightId);

    const highlightTimeInSeconds = this.parseRelativeTimestamp(
      recordingHighlight.relativeTimestamp,
      recordingHighlightId,
    );

    const { startTime, endTime, actualClipDuration } = this.calculateClipTiming(
      highlightTimeInSeconds,
      recordingHighlightId,
    );

    this.validateRecordingStartTime(recordingHighlight, recordingHighlightId);

    console.log(
      `Creating ${actualClipDuration}s clip ending at highlight moment`,
      {
        recordingHighlightId,
        highlightTimeInSeconds,
        relativeTimestamp: recordingHighlight.relativeTimestamp,
        clipStartTime: startTime,
        clipEndTime: endTime,
        actualClipDuration,
        explanation:
          actualClipDuration < DURATION_TO_BACKTRACK_SECONDS
            ? `Highlight too early - showing ${actualClipDuration}s from start to highlight`
            : `Full ${DURATION_TO_BACKTRACK_SECONDS}s clip before highlight moment`,
      },
    );

    try {
      const muxResponse = await this.createMuxClip(
        recording.muxAssetId,
        startTime,
        endTime,
      );
      console.log('createVideoClip: muxResponse received', {
        status: muxResponse?.status,
        data: muxResponse?.data,
      });

      return await this.handleSuccessfulClipCreation(
        muxResponse,
        recordingHighlightId,
        recording,
        queryRunner,
      );
    } catch (error) {
      console.log('createVideoClip: caught error from createMuxClip', {
        error: error?.message || error,
      });
      return await this.handleFailedClipCreation(
        error,
        recordingHighlightId,
        recording,
        recordingHighlight,
        queryRunner,
      );
    }
  }

  /**
   * Check Mux asset status for existing clip and update highlight accordingly
   */
  private async checkAndUpdateExistingClip(
    recordingHighlight: RecordingHighlightRow,
    queryRunner: QueryRunner,
  ): Promise<{ success: boolean; message: string }> {
    const assetId = recordingHighlight.assetId;

    if (!assetId) {
      console.log(
        `No assetId found for highlight ${recordingHighlight.id}, cannot check Mux status`,
      );
      return {
        success: false,
        message: 'No assetId to check Mux status',
      };
    }

    try {
      console.log(`Checking Mux asset status for assetId: ${assetId}`);
      const assetStatus = await this.checkMuxAssetStatus(assetId);

      console.log(`Mux asset status for ${assetId}:`, assetStatus);

      if (assetStatus.status === 'ready') {
        // Asset is ready, update highlight to ready
        const playbackUrl = assetStatus.playback_id
          ? `https://stream.mux.com/${assetStatus.playback_id}.m3u8`
          : null;

        await queryRunner.query(
          `
          UPDATE recording_highlights 
          SET 
            status = 'ready',
            mux_public_playback_url = $1,
            playback_id = $2,
            "isClipCreated" = true,
            updated_at = NOW()
          WHERE id = $3
        `,
          [playbackUrl, assetStatus.playback_id, recordingHighlight.id],
        );

        console.log(
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
        await queryRunner.query(
          `
          UPDATE recording_highlights 
          SET 
            status = 'failed',
            failed_message = $1,
            "isClipCreated" = true,
            updated_at = NOW()
          WHERE id = $2
        `,
          [
            `Mux asset ${assetStatus.status}: ${assetStatus.error || 'Unknown error'}`,
            recordingHighlight.id,
          ],
        );

        console.log(
          `Updated highlight ${recordingHighlight.id} to failed due to Mux asset error`,
        );

        return {
          success: false,
          message: `Mux asset failed: ${assetStatus.error || 'Unknown error'}`,
        };
      } else {
        // Asset still preparing
        console.log(
          `Highlight ${recordingHighlight.id} asset still ${assetStatus.status}, no update needed`,
        );

        return {
          success: true,
          message: `Asset still ${assetStatus.status}, waiting for completion`,
        };
      }
    } catch (error) {
      console.error(
        `Error checking Mux asset status for highlight ${recordingHighlight.id}:`,
        error,
      );

      // If we get a 404, the asset doesn't exist in Mux - need to recreate
      if (error?.response?.status === 404) {
        console.log(
          `Asset ${assetId} not found in Mux, resetting highlight for recreation`,
        );

        // Reset the highlight so it can be recreated
        await queryRunner.query(
          `
          UPDATE recording_highlights 
          SET 
            status = 'failed',
            asset_id = NULL,
            playback_id = NULL,
            mux_public_playback_url = NULL,
            "isClipCreated" = false,
            failed_message = 'Mux asset not found (404), needs recreation',
            updated_at = NOW()
          WHERE id = $1
        `,
          [recordingHighlight.id],
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
   * Process a preparing highlight by checking its Mux asset status
   */
  async processPreparingHighlight(
    highlight: RecordingHighlightRow,
  ): Promise<HighlightProcessingResult> {
    console.log(
      `Checking Mux asset status for preparing highlight ${highlight.id}`,
      {
        highlightId: highlight.id,
        assetId: highlight.assetId,
      },
    );

    const assetStatus = await this.checkMuxAssetStatus(highlight.assetId);

    console.log('processPreparingHighlight: Received assetStatus', assetStatus);

    if (assetStatus.status === 'ready') {
      return await this.markHighlightAsReady(highlight, assetStatus);
    } else if (
      assetStatus.status === 'errored' ||
      assetStatus.status === 'failed'
    ) {
      return await this.markHighlightAsFailed(highlight, assetStatus);
    } else {
      return this.skipStillPreparingHighlight(highlight, assetStatus);
    }
  }

  /**
   * Process a failed highlight by retrying video clip creation
   * Max retries: 2 (retryCount < 2)
   */
  async processFailedHighlight(
    highlight: RecordingHighlightRow,
  ): Promise<HighlightProcessingResult> {
    const currentRetryCount = highlight.retryCount || 0;

    // Check if max retries reached (max is 2, so retryCount must be < 2)
    if (currentRetryCount >= 2) {
      console.log(
        `Skipping highlight ${highlight.id} - max retries reached (retryCount=${currentRetryCount}, max=2)`,
        {
          highlightId: highlight.id,
          retryCount: currentRetryCount,
          maxRetries: 2,
        },
      );
      return {
        success: false,
        highlightId: highlight.id,
        recordingId: highlight.recordingId,
        error: `Max retries (2) reached. Current retryCount: ${currentRetryCount}`,
      };
    }

    const newRetryCount = currentRetryCount + 1;

    console.log(
      `Retrying failed highlight ${highlight.id} (Attempt ${newRetryCount}/2)`,
      {
        highlightId: highlight.id,
        recordingId: highlight.recordingId,
        currentStatus: highlight.status,
        failedMessage: highlight.failedMessage,
        currentRetryCount,
        newRetryCount,
        maxRetries: 2,
      },
    );

    await this.updateHighlightForRetry(highlight, newRetryCount);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      console.log('processFailedHighlight: About to call createVideoClip');
      const result = await this.createVideoClip(highlight.id, queryRunner);
      await queryRunner.commitTransaction();

      if (result.success) {
        console.log('processFailedHighlight: Clip creation success', result);
        return {
          success: true,
          highlightId: highlight.id,
          recordingId: highlight.recordingId,
          result,
        };
      } else {
        console.log('processFailedHighlight: Clip creation failed', result);
        return {
          success: false,
          highlightId: highlight.id,
          recordingId: highlight.recordingId,
          error: result.message || 'Retry failed',
        };
      }
    } catch (error) {
      console.log('processFailedHighlight: Caught error', { error });
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
      console.log('processFailedHighlight: Released queryRunner');
    }
  }

  /**
   * Mark highlight as permanently failed after max retries (2)
   */
  async markHighlightAsPermanentlyFailed(
    highlight: RecordingHighlightRow,
    error: any,
  ): Promise<void> {
    await this.dataSource.query(
      `
      UPDATE recording_highlights 
      SET 
        status = 'permanently_failed',
        failed_message = $1,
        metadata = $2,
        updated_at = NOW()
      WHERE id = $3
    `,
      [
        `Max retries (2) reached. Last error: ${error?.message || String(error)}`,
        JSON.stringify({
          ...highlight.metadata,
          permanentlyFailed: true,
          permanentlyFailedAt: new Date().toISOString(),
          finalError: error,
        }),
        highlight.id,
      ],
    );

    console.error(
      `Highlight ${highlight.id} marked as permanently failed after 5 retries`,
      {
        highlightId: highlight.id,
        finalError: error,
      },
    );
    console.log('markHighlightAsPermanentlyFailed: Updated highlight', {
      highlightId: highlight.id,
    });
  }

  // Private helper methods

  private validateRecordingHighlightId(recordingHighlightId: string): void {
    if (!recordingHighlightId || typeof recordingHighlightId !== 'string') {
      console.error(`Invalid recordingHighlightId: ${recordingHighlightId}`, {
        recordingHighlightId,
      });
      throw new Error('Invalid recordingHighlightId');
    }
    console.log('validateRecordingHighlightId: valid', {
      recordingHighlightId,
    });
  }

  private async getRecordingHighlight(
    recordingHighlightId: string,
    queryRunner: QueryRunner,
  ): Promise<RecordingHighlightRow> {
    const result = await queryRunner.query(
      `
      SELECT 
        rh.id,
        rh.recording_id AS "recordingId",
        rh.button_click_timestamp AS "buttonClickTimestamp",
        rh.relative_timestamp AS "relativeTimestamp",
        rh.source_asset_id AS "sourceAssetId",
        rh.asset_id AS "assetId",
        rh.status,
        rh.failed_message AS "failedMessage",
        rh.playback_id AS "playbackId",
        rh.mux_public_playback_url AS "muxPublicPlaybackUrl",
        rh."bucketName",
        rh.s3path,
        rh.metadata,
        rh."isClipCreated",
        rh."retryCount",
        rh.created_at as "createdAt",
        rh.updated_at as "updatedAt",
        r."startTime",
        r."endTime",
        r.mux_asset_id AS "muxAssetId"
      FROM recording_highlights rh
      LEFT JOIN recordings r ON rh.recording_id = r.id
      WHERE rh.id = $1
    `,
      [recordingHighlightId],
    );

    const recordingHighlight = result[0];
    if (!recordingHighlight) {
      console.error(
        `RecordingHighlight with ID ${recordingHighlightId} not found`,
        { recordingHighlightId },
      );
      throw new Error(
        `RecordingHighlight with ID ${recordingHighlightId} not found`,
      );
    }

    console.log('getRecordingHighlight: found highlight', {
      recordingHighlightId,
    });

    return recordingHighlight;
  }

  private validateRecording(recordingHighlight: RecordingHighlightRow): any {
    if (!recordingHighlight.muxAssetId) {
      console.error(
        `Associated recording not found for RecordingHighlight ID ${recordingHighlight.id}`,
        { recordingHighlightId: recordingHighlight.id },
      );
      throw new Error(
        `Associated recording not found for RecordingHighlight ID ${recordingHighlight.id}`,
      );
    }
    console.log('validateRecording: recording found', {
      recordingId: recordingHighlight.recordingId,
    });
    return recordingHighlight;
  }

  private validateRecordingAsset(
    recording: any,
    recordingHighlightId: string,
  ): void {
    if (!recording.muxAssetId) {
      console.error(`Recording does not have a Mux asset ID`, {
        recordingHighlightId,
      });
      throw new Error('Recording does not have a Mux asset ID');
    }
    console.log('validateRecordingAsset: Mux asset exists', {
      recordingHighlightId,
    });
  }

  private validateRelativeTimestamp(
    recordingHighlight: RecordingHighlightRow,
    recordingHighlightId: string,
  ): void {
    if (!recordingHighlight.relativeTimestamp) {
      console.error(
        `No relative timestamp found for RecordingHighlight ID ${recordingHighlightId}`,
        { recordingHighlightId },
      );
      throw new Error('No relative timestamp available for creating clip');
    }
    console.log('validateRelativeTimestamp: Relative timestamp exists', {
      recordingHighlightId,
    });
  }

  private parseRelativeTimestamp(
    relativeTimestamp: string,
    recordingHighlightId: string,
  ): number {
    const highlightTimeInSeconds =
      parseRelativeTimestampToSeconds(relativeTimestamp);

    console.log(
      `Parsed relative timestamp: ${relativeTimestamp} = ${highlightTimeInSeconds} seconds`,
      {
        recordingHighlightId,
        relativeTimestamp,
        highlightTimeInSeconds,
      },
    );

    return highlightTimeInSeconds;
  }

  private calculateClipTiming(
    highlightTimeInSeconds: number,
    recordingHighlightId: string,
  ) {
    const clipDuration = DURATION_TO_BACKTRACK_SECONDS;
    const endTime = highlightTimeInSeconds;
    let startTime = Math.max(0, highlightTimeInSeconds - clipDuration);

    if (startTime < 0) {
      console.warn(
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

    const actualClipDuration = endTime - startTime;

    console.log('calculateClipTiming', {
      recordingHighlightId,
      startTime,
      endTime,
      actualClipDuration,
      clipDuration,
    });

    return { startTime, endTime, actualClipDuration };
  }

  private validateRecordingStartTime(
    recordingHighlight: RecordingHighlightRow,
    recordingHighlightId: string,
  ): void {
    if (!recordingHighlight.startTime) {
      console.error(`Recording startTime is not available for validation`, {
        recordingHighlightId,
      });
      throw new Error('Recording startTime not available for clip validation');
    }
    console.log('validateRecordingStartTime: startTime exists', {
      recordingHighlightId,
    });
  }

  private async handleSuccessfulClipCreation(
    muxResponse: AxiosResponse,
    recordingHighlightId: string,
    recording: any,
    queryRunner: QueryRunner,
  ): Promise<VideoClipResult> {
    if (!muxResponse || muxResponse.status !== 201) {
      // Get current retryCount to increment
      const result = await queryRunner.query(
        `SELECT "retryCount" FROM recording_highlights WHERE id = $1`,
        [recordingHighlightId],
      );
      const currentRetryCount = result[0]?.retryCount || 0;
      const newRetryCount = currentRetryCount + 1;

      await queryRunner.query(
        `
        UPDATE recording_highlights 
        SET 
          status = $1,
          mux_public_playback_url = NULL,
          playback_id = NULL,
          asset_id = NULL,
          failed_message = $2,
          source_asset_id = $3,
          "isClipCreated" = false,
          "retryCount" = $4,
          updated_at = NOW()
        WHERE id = $5
      `,
        [
          muxResponse?.data?.status || 'failed',
          muxResponse?.data?.error?.message || 'Unknown error',
          recording.muxAssetId,
          newRetryCount,
          recordingHighlightId,
        ],
      );

      console.log(
        `Clip creation failed (non-201 status), retryCount incremented to ${newRetryCount}`,
        {
          recordingHighlightId,
          retryCount: newRetryCount,
          maxRetries: 2,
          muxResponseStatus: muxResponse?.status,
        },
      );

      console.error(
        `Failed to create video clip: ${muxResponse?.data?.error?.message || 'Unknown error'}`,
        {
          recordingHighlightId,
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
    await queryRunner.query(
      `
      UPDATE recording_highlights 
      SET 
        status = $1,
        mux_public_playback_url = NULL,
        asset_id = $2,
        playback_id = $3,
        source_asset_id = $4,
        "isClipCreated" = true,
        "retryCount" = 0,
        updated_at = NOW()
      WHERE id = $5
    `,
      [
        muxResponse.data.data.status || 'preparing',
        muxResponse.data.data.id,
        playbackId,
        recording.muxAssetId,
        recordingHighlightId,
      ],
    );

    console.log(
      `Video clip created successfully. Mux Asset ID: ${muxResponse.data.data.id}`,
      {
        recordingHighlightId,
        clipAssetId: muxResponse.data.data.id,
        playbackId,
        isClipCreated: true,
      },
    );

    return {
      success: true,
      recordingHighlightId,
      message: `Video clip created successfully. Mux Asset ID: ${muxResponse.data.data.id}`,
    };
  }

  private async handleFailedClipCreation(
    error: any,
    recordingHighlightId: string,
    recording: any,
    recordingHighlight: RecordingHighlightRow,
    queryRunner: QueryRunner,
  ): Promise<VideoClipResult> {
    // Increment retryCount on failure
    const currentRetryCount = recordingHighlight.retryCount || 0;
    const newRetryCount = currentRetryCount + 1;

    await queryRunner.query(
      `
      UPDATE recording_highlights 
      SET 
        status = 'failed',
        mux_public_playback_url = NULL,
        playback_id = NULL,
        asset_id = NULL,
        failed_message = $1,
        source_asset_id = $2,
        "isClipCreated" = false,
        "retryCount" = $3,
        updated_at = NOW()
      WHERE id = $4
    `,
      [
        error?.response?.data?.error?.message ||
          error.message ||
          'Unknown error',
        recording.muxAssetId,
        newRetryCount,
        recordingHighlightId,
      ],
    );

    console.log(
      `Clip creation failed, retryCount incremented to ${newRetryCount}`,
      {
        recordingHighlightId,
        retryCount: newRetryCount,
        maxRetries: 2,
      },
    );

    console.error(
      `Mux API Error: ${error?.response?.data?.error?.message || error.message}`,
      {
        recordingHighlightId,
      },
    );

    console.log('handleFailedClipCreation: updated highlight to failed', {
      recordingHighlightId,
    });

    return {
      success: false,
      recordingHighlightId,
      message: `Mux API Error: ${error?.response?.data?.error?.message || error.message}`,
    };
  }

  private async markHighlightAsReady(
    highlight: RecordingHighlightRow,
    assetStatus: MuxAssetStatus,
  ): Promise<HighlightProcessingResult> {
    const playbackUrl = assetStatus.playback_id
      ? `https://stream.mux.com/${assetStatus.playback_id}.m3u8`
      : null;

    await this.dataSource.query(
      `
      UPDATE recording_highlights 
      SET 
        status = 'ready',
        mux_public_playback_url = $1,
        playback_id = $2,
        updated_at = NOW()
      WHERE id = $3
    `,
      [playbackUrl, assetStatus.playback_id, highlight.id],
    );

    console.log(
      `Successfully updated preparing highlight ${highlight.id} to ready`,
      {
        highlightId: highlight.id,
        assetId: highlight.assetId,
        playbackUrl,
      },
    );

    return {
      success: true,
      highlightId: highlight.id,
      recordingId: highlight.recordingId,
      result: {
        message: 'Highlight marked as ready',
        assetId: highlight.assetId,
        playbackUrl,
      },
    };
  }

  private async markHighlightAsFailed(
    highlight: RecordingHighlightRow,
    assetStatus: MuxAssetStatus,
  ): Promise<HighlightProcessingResult> {
    await this.dataSource.query(
      `
      UPDATE recording_highlights 
      SET 
        status = 'failed',
        failed_message = $1,
        updated_at = NOW()
      WHERE id = $2
    `,
      [
        `Mux asset failed: ${assetStatus.error || 'Unknown error'}`,
        highlight.id,
      ],
    );

    console.log(`Mux asset failed for highlight ${highlight.id}`, {
      highlightId: highlight.id,
      assetId: highlight.assetId,
      error: assetStatus.error,
    });

    return {
      success: false,
      highlightId: highlight.id,
      recordingId: highlight.recordingId,
      error: `Mux asset failed: ${assetStatus.error || 'Unknown error'}`,
    };
  }

  private skipStillPreparingHighlight(
    highlight: RecordingHighlightRow,
    assetStatus: MuxAssetStatus,
  ): HighlightProcessingResult {
    console.log(`Highlight ${highlight.id} asset still preparing, skipping`, {
      highlightId: highlight.id,
      assetId: highlight.assetId,
      assetStatus: assetStatus.status,
    });

    return {
      success: true, // Not an error, just skipped
      highlightId: highlight.id,
      recordingId: highlight.recordingId,
      result: {
        message: 'Highlight still preparing, skipped',
        assetStatus: assetStatus.status,
      },
    };
  }

  private async updateHighlightForRetry(
    highlight: RecordingHighlightRow,
    newRetryCount: number,
  ): Promise<void> {
    await this.dataSource.query(
      `
      UPDATE recording_highlights 
      SET 
        status = 'preparing',
        failed_message = NULL,
        asset_id = NULL,
        playback_id = NULL,
        mux_public_playback_url = NULL,
        "retryCount" = $1,
        "isClipCreated" = false,
        metadata = $2,
        updated_at = NOW()
      WHERE id = $3
    `,
      [
        newRetryCount,
        JSON.stringify({
          ...highlight.metadata,
          lastRetryAttempt: new Date().toISOString(),
          retryHistory: [
            ...(highlight.metadata?.retryHistory || []),
            {
              attempt: newRetryCount,
              timestamp: new Date().toISOString(),
              previousStatus: highlight.status,
              previousErrorMessage: highlight.failedMessage,
            },
          ],
        }),
        highlight.id,
      ],
    );
    console.log('updateHighlightForRetry: highlight updated for retry', {
      highlightId: highlight.id,
      newRetryCount,
    });
  }
}
