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

      // Check if user has paid for this recording
      const payment = await this.paymentRepository.findOne({
        where: {
          user_id: userId,
          recording_id: recordingId,
          status: PaymentStatus.COMPLETED,
          payment_type: In([
            PaymentType.RECORDING_ACCESS,
            PaymentType.HIGHLIGHT_ACCESS,
          ]),
        },
      });

      if (payment) {
        this.logger.log(`User has paid access for recording: ${recordingId}`);
        return {
          canAccess: true,
          reason: 'User has paid access',
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
