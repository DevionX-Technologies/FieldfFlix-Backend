import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recording } from '../entities/recording.entity';
import { RecordingHighlights } from '../entities/recording-highlights.entity';
import { PaymentRestrictionService } from '../../payment/payment-restriction.service';
import { Request } from 'express';
import { CommonService } from 'src/common/service/common.service';

@Injectable()
export class RecordingPaymentService {
  private readonly logger = new Logger(RecordingPaymentService.name);

  constructor(
    @InjectRepository(Recording)
    private readonly recordingRepository: Repository<Recording>,
    @InjectRepository(RecordingHighlights)
    private readonly recordingHighlightsRepository: Repository<RecordingHighlights>,
    private readonly paymentRestrictionService: PaymentRestrictionService,
    private readonly commonService: CommonService,
  ) {}

  async getRecordingPlaybackUrl(
    recordingId: string,
    userId: string,
    requestedDuration?: number,
  ): Promise<{
    playbackUrl: string;
    accessInfo: {
      hasPaidAccess: boolean;
      freeDuration?: number;
      paymentRequired?: boolean;
      hourlyRate?: number;
    };
  }> {
    try {
      this.logger.log(
        `Getting playback URL for recording: ${recordingId}, user: ${userId}`,
      );

      // Get recording details
      const recording = await this.recordingRepository.findOne({
        where: { id: recordingId },
        select: ['id', 'mux_playback_id', 'mux_media_url'],
      });

      if (!recording) {
        throw new NotFoundException('Recording not found');
      }

      if (!recording.mux_playback_id) {
        throw new NotFoundException('Recording playback not available');
      }

      // Check payment access
      const accessCheck =
        await this.paymentRestrictionService.checkRecordingAccess(
          userId,
          recordingId,
          requestedDuration,
        );

      const playbackUrl = `https://stream.mux.com/${recording.mux_playback_id}.m3u8`;

      return {
        playbackUrl,
        accessInfo: {
          hasPaidAccess: accessCheck.canAccess && !accessCheck.paymentRequired,
          freeDuration: accessCheck.freeDuration,
          paymentRequired: accessCheck.paymentRequired,
          hourlyRate: this.paymentRestrictionService.getHourlyRate(),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get recording playback URL', error);
      throw error;
    }
  }

  /**
   * Get recording metadata with payment information
   * @param recordingId - Recording ID
   * @param userId - User ID
   * @returns Promise<any>
   */
  async getRecordingMetadata(
    req: Request,
    recordingId: string,
  ): Promise<{
    recording: Recording;
    paymentInfo: {
      hasPaidAccess: boolean;
      freeDuration: number;
      hourlyRate: number;
      paymentRequired: boolean;
    };
  }> {
    try {
      const tokenData = await this.commonService.extractDataFromToken(req);
      this.logger.log(
        `Getting metadata for recording: ${recordingId}, user: ${tokenData.user_id}`,
      );

      // Get recording details
      const recording = await this.recordingRepository.findOne({
        where: { id: recordingId },
      });

      if (!recording) {
        throw new NotFoundException('Recording not found');
      }

      // Check payment access
      const accessCheck =
        await this.paymentRestrictionService.checkRecordingAccess(
          tokenData.user_id,
          recordingId,
        );

      return {
        recording,
        paymentInfo: {
          hasPaidAccess: accessCheck.canAccess && !accessCheck.paymentRequired,
          freeDuration:
            this.paymentRestrictionService.getFreePlaybackDuration(),
          hourlyRate: this.paymentRestrictionService.getHourlyRate(),
          paymentRequired: accessCheck.paymentRequired || false,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get recording metadata', error);
      throw error;
    }
  }

  /**
   * Get highlight metadata with payment information
   * @param highlightId - Highlight ID
   * @param userId - User ID
   * @returns Promise<any>
   */
  async getHighlightMetadata(
    highlightId: string,
    req: Request,
  ): Promise<{
    highlight: RecordingHighlights;
    paymentInfo: {
      hasPaidAccess: boolean;
      hourlyRate: number;
      paymentRequired: boolean;
    };
  }> {
    try {
      const tokenData = await this.commonService.extractDataFromToken(req);
      this.logger.log(
        `Getting metadata for highlight: ${highlightId}, user: ${tokenData.user_id}`,
      );

      // Get highlight details
      const highlight = await this.recordingHighlightsRepository.findOne({
        where: { id: highlightId },
        relations: ['recording'],
      });

      if (!highlight) {
        throw new NotFoundException('Highlight not found');
      }

      // Check payment access
      const accessCheck =
        await this.paymentRestrictionService.checkRecordingAccess(
          tokenData.user_id,
          highlightId,
        );

      return {
        highlight,
        paymentInfo: {
          hasPaidAccess: accessCheck.canAccess,
          hourlyRate: this.paymentRestrictionService.getHourlyRate(),
          paymentRequired: accessCheck.paymentRequired || false,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get highlight metadata', error);
      throw error;
    }
  }
}
