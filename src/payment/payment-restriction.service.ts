import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  PaymentEntity,
  PaymentStatus,
  PaymentType,
} from './entities/payment.entity';

@Injectable()
export class PaymentRestrictionService {
  private readonly logger = new Logger(PaymentRestrictionService.name);
  private readonly FREE_PLAYBACK_DURATION = 3 * 60; // 3 minutes in seconds
  private readonly HOURLY_RATE = 240; // ₹240 per hour

  constructor(
    @InjectRepository(PaymentEntity)
    private readonly paymentRepository: Repository<PaymentEntity>,
  ) {}

  /**
   * Group-unlock semantics for recording / highlight access.
   *
   * A recording is unlocked for everyone with access (the owner + anyone who
   * claimed it via "Find My Recording" via SharedRecording) as soon as ANY of
   * them completes a payment of type RECORDING_ACCESS or HIGHLIGHT_ACCESS.
   *
   * Access (who is allowed to consume the unlock) is enforced upstream by the
   * route guards / repository scoping — those layers already restrict the
   * recording id to the owner + shared list. We only answer the question
   * "is this recording id unlocked for SOMEBODY?" here.
   */
  async hasAnyCompletedPaymentForRecording(
    recordingId: string,
  ): Promise<boolean> {
    const payment = await this.paymentRepository.findOne({
      where: {
        recording_id: recordingId,
        status: PaymentStatus.COMPLETED,
        payment_type: In([
          PaymentType.RECORDING_ACCESS,
          PaymentType.HIGHLIGHT_ACCESS,
        ]),
      },
    });
    return !!payment;
  }

  async checkRecordingAccess(
    userId: string,
    recordingId: string,
    requestedDuration?: number,
  ): Promise<{
    canAccess: boolean;
    reason?: string;
    freeDuration?: number;
    paymentRequired?: boolean;
  }> {
    try {
      this.logger.log(
        `Checking recording access for user: ${userId}, recording: ${recordingId}`,
      );

      // Group unlock: any user (owner OR a Find-My-Recording claimer) who
      // already paid unlocks playback for everyone with access.
      const groupPaid =
        await this.hasAnyCompletedPaymentForRecording(recordingId);

      if (groupPaid) {
        this.logger.log(
          `Recording ${recordingId} unlocked via group payment for user ${userId}`,
        );
        return {
          canAccess: true,
          reason: 'Recording paid by a group member',
        };
      }

      // Check if requested duration exceeds free limit
      if (
        requestedDuration &&
        requestedDuration > this.FREE_PLAYBACK_DURATION
      ) {
        this.logger.log(
          `Requested duration exceeds free limit: ${requestedDuration}s`,
        );
        return {
          canAccess: false,
          reason: 'Payment required for extended playback',
          freeDuration: this.FREE_PLAYBACK_DURATION,
          paymentRequired: true,
        };
      }

      // Allow free access up to 3 minutes
      this.logger.log(
        `Allowing free access up to ${this.FREE_PLAYBACK_DURATION} seconds`,
      );
      return {
        canAccess: true,
        reason: 'Free access within limit',
        freeDuration: this.FREE_PLAYBACK_DURATION,
      };
    } catch (error) {
      this.logger.error('Failed to check recording access', error);
      return {
        canAccess: false,
        reason: 'Error checking access',
      };
    }
  }

  /**
   * True when SOMEONE in the recording's group (owner or claimer) has a
   * completed RECORDING_ACCESS or HIGHLIGHT_ACCESS payment. Used by export /
   * share gates so the in-app lock icon and the gated flows agree.
   *
   * Note: this intentionally ignores `userId`. Group-unlock semantics — one
   * member pays, everyone with access plays. The `userId` parameter is kept
   * for compatibility with existing call sites.
   */
  async hasCompletedRecordingOrHighlightAccess(
    _userId: string,
    recordingId: string,
  ): Promise<boolean> {
    return this.hasAnyCompletedPaymentForRecording(recordingId);
  }

  calculatePaymentAmount(durationInSeconds: number): number {
    const hours = durationInSeconds / 3600;
    return Math.ceil(hours * this.HOURLY_RATE);
  }

  getFreePlaybackDuration(): number {
    return this.FREE_PLAYBACK_DURATION;
  }

  getHourlyRate(): number {
    return this.HOURLY_RATE;
  }
}
