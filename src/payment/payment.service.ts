import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PaymentEntity,
  PaymentStatus,
  PaymentType,
} from './entities/payment.entity';
import {
  CreatePaymentOrderDto,
  CreatePlanOrderDto,
  VerifyPaymentDto,
  PaymentResponseDto,
  PaymentVerificationResponseDto,
} from './dto/payment.dto';
import { RazorpayService } from '../common/service/razorpay.service';
import { User } from '../user/entities/user.entity';
import { Recording } from '../recording/entities/recording.entity';
import { Request } from 'express';
import { CommonService } from 'src/common/service/common.service';
import { MuxService } from '../mux/mux.service';
import { HOURLY_RATE } from 'src/constant/constant';
import { calculatePaymentAmountFromDuration } from 'src/utils/utils';
/**
 * Payment service for handling payment operations
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(PaymentEntity)
    private readonly paymentRepository: Repository<PaymentEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Recording)
    private readonly recordingRepository: Repository<Recording>,
    private readonly razorpayService: RazorpayService,
    private readonly commonService: CommonService,
    private readonly muxService: MuxService,
  ) {}

  async createPaymentOrderForRecording(
    req: Request,
    recordingId: string,
  ): Promise<PaymentResponseDto> {
    try {
      this.logger.log(`Creating payment order for recording: ${recordingId}`);

      const tokenData = await this.commonService.extractDataFromToken(req);
      // Get user_id from token
      this.logger.log(`Creating payment order for user: ${tokenData.user_id}`);

      // Validate user exists
      const user = await this.userRepository.findOne({
        where: { id: tokenData.user_id },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Validate recording exists
      const recording = await this.recordingRepository.findOne({
        where: { id: recordingId },
      });
      if (!recording) {
        throw new NotFoundException('Recording not found');
      }

      // Check if user already has a valid payment for this recording
      const existingPayment = await this.paymentRepository.findOne({
        where: {
          user_id: tokenData.user_id,
          recording_id: recordingId,
        },
      });

      if (existingPayment) {
        // If payment is pending or completed, return the existing payment
        if (
          existingPayment.status === PaymentStatus.PENDING ||
          existingPayment.status === PaymentStatus.COMPLETED
        ) {
          return {
            id: existingPayment.id,
            razorpay_order_id: existingPayment.razorpay_order_id,
            amount: existingPayment.amount,
            currency: existingPayment.currency,
            base_amount: existingPayment.base_amount,
            status: existingPayment.status,
            payment_type: existingPayment.payment_type,
            created_at: existingPayment.created_at,
            expires_at: existingPayment.expires_at,
          };
        }
      }
      // Get video duration from Mux API using asset ID
      let durationInSeconds = 0;
      if (recording.mux_asset_id) {
        try {
          const assetDetails = await this.muxService.getAssetDetails(
            recording.mux_asset_id,
          );
          durationInSeconds = assetDetails.duration || 0;
          this.logger.log(
            `Retrieved duration from Mux: ${durationInSeconds} seconds for recording: ${recordingId}`,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to get duration from Mux for recording: ${recordingId}`,
            error,
          );
          // Fallback to hourly rate if Mux duration is not available
          durationInSeconds = 0;
        }
      }

      // Calculate payment amount based on duration
      const paymentAmount =
        durationInSeconds > 0
          ? calculatePaymentAmountFromDuration(durationInSeconds)
          : HOURLY_RATE;

      const createPaymentDto: CreatePaymentOrderDto = {
        amount: paymentAmount,
        payment_type: PaymentType.RECORDING_ACCESS,
        recording_id: recordingId,
        description: `Payment for ${durationInSeconds > 0 ? Math.ceil(durationInSeconds / 3600) : 1} hour(s) of recording access`,
      };

      const result = await this.createPaymentOrder(
        tokenData.user_id,
        createPaymentDto,
      );

      return result;
    } catch (error) {
      this.logger.error('Failed to create payment order for recording', error);
      throw error;
    }
  }

  /**
   * One-time plan purchase (Razorpay). Uses `MEDIA_ACCESS` as a general “non-recording”
   * payment type until a dedicated `SUBSCRIPTION` type exists in the schema.
   */
  async createPlanOrder(
    userId: string,
    plan: CreatePlanOrderDto['plan'],
  ): Promise<PaymentResponseDto> {
    const prices: Record<CreatePlanOrderDto['plan'], number> = {
      free: 149,
      pro: 199,
      premium: 399,
    };
    const amount = prices[plan];
    if (amount == null) {
      throw new BadRequestException('Invalid plan');
    }
    return this.createPaymentOrder(userId, {
      amount,
      payment_type: PaymentType.MEDIA_ACCESS,
      description: `FieldFlicks ${plan} plan`,
    });
  }

  async createPaymentOrder(
    userId: string,
    createPaymentDto: CreatePaymentOrderDto,
  ): Promise<PaymentResponseDto> {
    try {
      // Convert amount to paise
      const amountInPaise = this.razorpayService.convertRupeesToPaise(
        createPaymentDto.amount,
      );

      // Create payment entity
      const payment = this.paymentRepository.create({
        user_id: userId,
        recording_id: createPaymentDto.recording_id,
        amount: createPaymentDto.amount,
        base_amount: HOURLY_RATE,
        currency: 'INR',
        status: PaymentStatus.PENDING,
        payment_type: createPaymentDto.payment_type,
        description: createPaymentDto.description,
      });

      const savedPayment = await this.paymentRepository.save(payment);

      // Create Razorpay order
      const razorpayOrder = await this.razorpayService.createOrder(
        amountInPaise,
        'INR',
        savedPayment.id,
        {
          user_id: userId,
          payment_id: savedPayment.id,
          payment_type: createPaymentDto.payment_type,
        },
      );

      // Update payment with Razorpay order details
      savedPayment.razorpay_order_id = razorpayOrder.id;
      savedPayment.expires_at = new Date(Date.now() + 30 * 60 * 1000);
      await this.paymentRepository.save(savedPayment);

      this.logger.log(`Payment order created successfully: ${savedPayment.id}`);

      return {
        id: savedPayment.id,
        razorpay_order_id: savedPayment.razorpay_order_id,
        amount: savedPayment.amount,
        base_amount: savedPayment.base_amount,
        currency: savedPayment.currency,
        status: savedPayment.status,
        payment_type: savedPayment.payment_type,
        created_at: savedPayment.created_at,
        expires_at: savedPayment.expires_at,
      };
    } catch (error) {
      this.logger.error('Failed to create payment order', error);
      throw error;
    }
  }

  async verifyPayment(
    userId: string,
    verifyPaymentDto: VerifyPaymentDto,
  ): Promise<PaymentVerificationResponseDto> {
    try {
      this.logger.log(`Verifying payment for user: ${userId}`);

      // Find payment by order ID
      const payment = await this.paymentRepository.findOne({
        where: {
          razorpay_order_id: verifyPaymentDto.razorpay_order_id,
          user_id: userId,
        },
      });

      if (!payment) {
        throw new NotFoundException({
          message: 'Payment not found',
          detail: `No payment found with order ID: ${verifyPaymentDto.razorpay_order_id} for user: ${userId}`,
        });
      }

      if (payment.status !== PaymentStatus.PENDING) {
        throw new BadRequestException({
          message: 'Payment already processed',
          detail: `Current payment status is '${payment.status}' for payment ID: ${payment.id}`,
        });
      }

      // Update payment status based on the provided status
      payment.status = verifyPaymentDto.status;
      payment.razorpay_payment_id = verifyPaymentDto.razorpay_payment_id;

      // Set paid_at only if payment is completed
      if (verifyPaymentDto.status === PaymentStatus.COMPLETED) {
        payment.paid_at = new Date();
      }

      await this.paymentRepository.update(payment.id, payment);

      this.logger.log(`Payment verified successfully: ${payment.id}`);

      return {
        success: true,
        payment_id: payment.id,
        razorpay_payment_id: payment.razorpay_payment_id,
        message: 'Payment verified successfully',
      };
    } catch (error) {
      this.logger.error('Failed to verify payment', error);
      throw error;
    }
  }

  /**
   * Returns the latest active premium plan for a user (one-time `MEDIA_ACCESS` payment).
   * Plan name is parsed back from `description` since the payments schema does not
   * carry a dedicated plan column yet ("FieldFlicks pro plan" -> "pro").
   */
  async getActivePlan(userId: string): Promise<{
    active: boolean;
    plan: 'free' | 'pro' | 'premium' | null;
    paid_at: Date | null;
    expires_at: Date | null;
    payment_id: string | null;
  }> {
    try {
      const payment = await this.paymentRepository.findOne({
        where: {
          user_id: userId,
          status: PaymentStatus.COMPLETED,
          payment_type: PaymentType.MEDIA_ACCESS,
        },
        order: { paid_at: 'DESC', created_at: 'DESC' },
      });

      if (!payment) {
        return { active: false, plan: null, paid_at: null, expires_at: null, payment_id: null };
      }

      // Plan-style purchases have `expires_at == null` (lifetime). Order-style purchases
      // (recording access) keep their 30-min order TTL in `expires_at`; ignore those for plans.
      // For now, treat any completed MEDIA_ACCESS as "active".
      const desc = (payment.description || '').toLowerCase();
      let plan: 'free' | 'pro' | 'premium' | null = null;
      if (desc.includes('premium')) plan = 'premium';
      else if (desc.includes('pro')) plan = 'pro';
      else if (desc.includes('free')) plan = 'free';

      return {
        active: true,
        plan,
        paid_at: payment.paid_at ?? null,
        expires_at: null,
        payment_id: payment.id,
      };
    } catch (error) {
      this.logger.error('Failed to load active plan', error);
      return { active: false, plan: null, paid_at: null, expires_at: null, payment_id: null };
    }
  }

  async hasUserPaidForContent(
    userId: string,
    recordingId?: string,
  ): Promise<boolean> {
    try {
      const payment = await this.paymentRepository.findOne({
        where: {
          user_id: userId,
          recording_id: recordingId,
          status: PaymentStatus.COMPLETED,
        },
      });

      return !!payment;
    } catch (error) {
      this.logger.error('Failed to check payment status', error);
      return false;
    }
  }

  async getUserPaymentHistory(userId: string): Promise<PaymentEntity[]> {
    try {
      return await this.paymentRepository.find({
        where: { user_id: userId },
        order: { created_at: 'DESC' },
        relations: ['recording'],
      });
    } catch (error) {
      this.logger.error('Failed to get payment history', error);
      throw error;
    }
  }

  async getPaymentById(
    paymentId: string,
    userId: string,
  ): Promise<PaymentEntity> {
    try {
      const payment = await this.paymentRepository.findOne({
        where: { id: paymentId, user_id: userId },
        relations: ['recording'],
      });

      if (!payment) {
        throw new NotFoundException('Payment not found');
      }

      return payment;
    } catch (error) {
      this.logger.error('Failed to get payment details', error);
      throw error;
    }
  }

  async refundPayment(
    paymentId: string,
    userId: string,
    amount?: number,
  ): Promise<any> {
    try {
      const payment = await this.paymentRepository.findOne({
        where: { id: paymentId, user_id: userId },
      });

      if (!payment) {
        throw new NotFoundException('Payment not found');
      }

      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new BadRequestException(
          'Only completed payments can be refunded',
        );
      }

      if (!payment.razorpay_payment_id) {
        throw new BadRequestException('Payment ID not found');
      }

      const refundAmount = amount
        ? this.razorpayService.convertRupeesToPaise(amount)
        : undefined;

      const refund = await this.razorpayService.refundPayment(
        payment.razorpay_payment_id,
        refundAmount,
        { payment_id: paymentId, user_id: userId },
      );

      // Update payment status
      payment.status = PaymentStatus.REFUNDED;
      await this.paymentRepository.save(payment);

      this.logger.log(`Payment refunded successfully: ${paymentId}`);

      return refund;
    } catch (error) {
      this.logger.error('Failed to refund payment', error);
      throw error;
    }
  }
}
