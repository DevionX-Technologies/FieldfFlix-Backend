import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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
import { SharedRecording } from '../recording/entities/shared-recording.entity';
import { PointsService } from '../points/points.service';
import { PointEventType } from '../points/entities/point-event.entity';
import { CouponsService } from '../coupons/coupons.service';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { CommonService } from 'src/common/service/common.service';
import { HOURLY_RATE } from 'src/constant/constant';
import {
  HALF_HOUR_SEC,
  RECORDING_UNLOCK_BASE_INR,
  recordingUnlockBaseInr,
  recordingUnlockTotalInr,
  parsePlannedDurationSecFromMetadata,
  resolveUnlockTierFromRecording,
} from 'src/utils/recording-pricing';
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
    @InjectRepository(SharedRecording)
    private readonly sharedRecordingRepository: Repository<SharedRecording>,
    private readonly razorpayService: RazorpayService,
    private readonly commonService: CommonService,
    private readonly pointsService: PointsService,
    private readonly couponsService: CouponsService,
  ) {}

  /**
   * One recording unlock price from session metadata (preferred) or a single turf sport.
   * Matches mobile Highlights pricing tiers.
   */
  private unlockTierAndAmounts(recording: Recording): {
    tier: keyof typeof RECORDING_UNLOCK_BASE_INR;
    base: number;
    total: number;
  } {
    const tier = resolveUnlockTierFromRecording(recording);
    const plannedSec =
      parsePlannedDurationSecFromMetadata(recording.metadata) ?? HALF_HOUR_SEC;
    const base = recordingUnlockBaseInr(tier, plannedSec);
    const total = recordingUnlockTotalInr(base);
    return { tier, base, total };
  }

  async createPaymentOrderForRecording(
    req: Request,
    recordingId: string,
    couponCode?: string | null,
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

      // Validate recording exists (turf resolves unlock tier).
      const recording = await this.recordingRepository.findOne({
        where: { id: recordingId },
        relations: ['turf'],
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

      const {
        tier,
        base,
        total: undiscountedTotal,
      } = this.unlockTierAndAmounts(recording);
      const label =
        tier === 'pickleball'
          ? 'Pickleball'
          : tier === 'padel'
            ? 'Padel'
            : 'Cricket';

      // Apply a coupon if the caller passed one. We re-preview here (rather
      // than trusting a discounted price from the client) so a tampered
      // request body can't grant arbitrary discounts. The assignment id
      // is persisted on the payment row's metadata and consumed on verify.
      let total = undiscountedTotal;
      let couponAssignmentId: string | null = null;
      let couponDiscountInr = 0;
      let couponLabel: string | null = null;
      if (couponCode && couponCode.trim()) {
        const preview = await this.couponsService.previewDiscount(
          tokenData.user_id,
          couponCode,
          Math.round(undiscountedTotal),
        );
        if (preview) {
          total = preview.discountedPriceInr;
          couponAssignmentId = preview.assignmentId;
          couponDiscountInr = Math.max(
            0,
            Math.round(undiscountedTotal) - preview.discountedPriceInr,
          );
          couponLabel = preview.label;
        }
      }

      if (total <= 0) {
        const payment = this.paymentRepository.create({
          user_id: tokenData.user_id,
          recording_id: recordingId,
          amount: 0,
          base_amount: 0,
          currency: 'INR',
          status: PaymentStatus.COMPLETED,
          payment_type: PaymentType.RECORDING_ACCESS,
          description: `${label} recording unlock (free)`,
          razorpay_order_id: `ff_rcfree_${randomUUID()}`.slice(0, 100),
          razorpay_payment_id: null,
          paid_at: new Date(),
          expires_at: null,
        });
        const saved = await this.paymentRepository.save(payment);
        return {
          id: saved.id,
          razorpay_order_id: saved.razorpay_order_id,
          amount: Number(saved.amount),
          currency: saved.currency,
          base_amount: Number(saved.base_amount),
          status: saved.status,
          payment_type: saved.payment_type,
          created_at: saved.created_at,
          expires_at: saved.expires_at ?? undefined,
        };
      }

      const createPaymentDto: CreatePaymentOrderDto = {
        amount: total,
        base_amount: base,
        payment_type: PaymentType.RECORDING_ACCESS,
        recording_id: recordingId,
        description: couponAssignmentId
          ? `${label} full recording unlock — ${couponLabel} applied`
          : `${label} full recording unlock`,
      };

      const order = await this.createPaymentOrder(
        tokenData.user_id,
        createPaymentDto,
      );

      // Stash the coupon assignment id on the just-created payment row's
      // metadata so `verifyPayment` can call `coupons.redeem` once the user
      // actually pays. We re-fetch by razorpay_order_id (the id we just got
      // back from createPaymentOrder) to find the row.
      if (couponAssignmentId) {
        try {
          const paymentRow = await this.paymentRepository.findOne({
            where: { razorpay_order_id: order.razorpay_order_id },
          });
          if (paymentRow) {
            paymentRow.metadata = {
              ...(paymentRow.metadata ?? {}),
              coupon: {
                assignmentId: couponAssignmentId,
                discountInr: couponDiscountInr,
                label: couponLabel,
                undiscountedTotal,
              },
            };
            await this.paymentRepository.save(paymentRow);
          }
        } catch (err) {
          this.logger.warn(
            `Failed to persist coupon metadata on payment for order ${order.razorpay_order_id}: ${(err as Error)?.message ?? err}`,
          );
        }
      }

      return order;
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
    if (plan === 'cricket') {
      const payment = this.paymentRepository.create({
        user_id: userId,
        recording_id: null,
        amount: 0,
        base_amount: 0,
        currency: 'INR',
        status: PaymentStatus.COMPLETED,
        payment_type: PaymentType.MEDIA_ACCESS,
        description: 'FieldFlicks cricket plan (free)',
        razorpay_order_id: `ff_free_${randomUUID()}`.slice(0, 100),
        razorpay_payment_id: null,
        paid_at: new Date(),
        expires_at: null,
      });
      const saved = await this.paymentRepository.save(payment);
      return {
        id: saved.id,
        razorpay_order_id: saved.razorpay_order_id,
        amount: Number(saved.amount),
        base_amount: Number(saved.base_amount),
        currency: saved.currency,
        status: saved.status,
        payment_type: saved.payment_type,
        created_at: saved.created_at,
        expires_at: saved.expires_at ?? undefined,
      };
    }

    if (plan === 'pickleball' || plan === 'padel') {
      const base = plan === 'pickleball' ? 200 : 250;
      const amount = Math.round(base * 1.18);
      return this.createPaymentOrder(userId, {
        amount,
        payment_type: PaymentType.MEDIA_ACCESS,
        description: `FieldFlicks ${plan} plan (incl. 18% GST)`,
        base_amount: base,
      });
    }

    const legacy: Partial<Record<CreatePlanOrderDto['plan'], number>> = {
      free: 149,
      pro: 199,
      premium: 399,
    };
    const amount = legacy[plan];
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
        base_amount: createPaymentDto.base_amount ?? HOURLY_RATE,
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

      const razorpayPaymentId = verifyPaymentDto.razorpay_payment_id?.trim();
      if (!razorpayPaymentId) {
        throw new BadRequestException({
          message: 'Invalid request',
          detail: 'razorpay_payment_id is required',
        });
      }

      if (verifyPaymentDto.status === PaymentStatus.COMPLETED) {
        const signature = verifyPaymentDto.razorpay_signature?.trim();
        if (!signature) {
          throw new BadRequestException({
            message: 'Verification failed',
            detail: 'razorpay_signature is required for completed payments',
          });
        }

        const signatureValid = await this.razorpayService.verifyPayment(
          verifyPaymentDto.razorpay_order_id,
          razorpayPaymentId,
          signature,
        );
        if (!signatureValid) {
          throw new BadRequestException({
            message: 'Verification failed',
            detail: 'Invalid Razorpay payment signature',
          });
        }

        let rpPayment: { order_id?: string; status?: string; amount?: number };
        try {
          rpPayment =
            await this.razorpayService.getPaymentDetails(razorpayPaymentId);
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Razorpay fetch failed during verify — refusing to unlock: ${detail}`,
          );
          throw new BadRequestException({
            message: 'Verification failed',
            detail: 'Could not confirm payment with Razorpay',
          });
        }

        if (rpPayment?.order_id !== verifyPaymentDto.razorpay_order_id) {
          throw new BadRequestException({
            message: 'Verification failed',
            detail: 'Razorpay payment does not belong to this order',
          });
        }

        const remoteStatus = String(rpPayment?.status ?? '').toLowerCase();
        if (remoteStatus !== 'captured' && remoteStatus !== 'authorized') {
          throw new BadRequestException({
            message: 'Verification failed',
            detail: `Razorpay reports payment status "${remoteStatus}" — not payable`,
          });
        }

        const remoteRupees = Number(rpPayment.amount) / 100;
        const expectedRupees = Number(payment.amount);
        if (
          Number.isFinite(remoteRupees) &&
          Number.isFinite(expectedRupees) &&
          Math.abs(remoteRupees - expectedRupees) > 0.015
        ) {
          throw new BadRequestException({
            message: 'Verification failed',
            detail: 'Payment amount does not match order',
          });
        }

        payment.razorpay_signature = signature;
      }

      payment.status = verifyPaymentDto.status;
      payment.razorpay_payment_id = razorpayPaymentId;

      // Set paid_at only if payment is completed
      if (verifyPaymentDto.status === PaymentStatus.COMPLETED) {
        payment.paid_at = new Date();
      }

      await this.paymentRepository.update(payment.id, payment);

      this.logger.log(`Payment verified successfully: ${payment.id}`);

      // Best-effort points award for the user that just successfully paid.
      // Idempotency by paymentId: a retry of `verify` won't double-credit.
      if (
        verifyPaymentDto.status === PaymentStatus.COMPLETED &&
        payment.user_id
      ) {
        void this.pointsService
          .awardPoints({
            userId: payment.user_id,
            eventType: PointEventType.PAYMENT_COMPLETE,
            refId: payment.id,
            metadata: {
              paymentId: payment.id,
              recordingId: payment.recording_id ?? null,
              paymentType: payment.payment_type,
            },
          })
          .catch((err) =>
            this.logger.warn(
              `awardPoints(PAYMENT_COMPLETE, user=${payment.user_id}, payment=${payment.id}) failed: ${
                (err as Error)?.message ?? String(err)
              }`,
            ),
          );

        // If the payment had a coupon attached at order-creation time,
        // consume it now. Idempotent by paymentId — retries don't
        // double-decrement. We deliberately don't refund the user if
        // redeem returns null (e.g. coupon expired between order and pay) —
        // they already paid the discounted amount via Razorpay; we just
        // log so admin can investigate.
        const couponMeta = (payment.metadata as Record<string, unknown>)?.[
          'coupon'
        ] as
          | {
              assignmentId?: string;
              undiscountedTotal?: number;
            }
          | undefined;
        if (couponMeta?.assignmentId) {
          try {
            const redemption = await this.couponsService.redeem({
              userId: payment.user_id,
              assignmentId: couponMeta.assignmentId,
              paymentId: payment.id,
              recordingId: payment.recording_id ?? null,
              basePriceInr: Math.round(
                couponMeta.undiscountedTotal ?? Number(payment.amount),
              ),
            });
            if (!redemption) {
              this.logger.warn(
                `Coupon assignment ${couponMeta.assignmentId} could not be redeemed at verify (already exhausted or expired). Payment ${payment.id} kept; admin action may be needed.`,
              );
            }
          } catch (err) {
            this.logger.warn(
              `Coupon redeem at verify failed for payment ${payment.id}: ${(err as Error)?.message ?? err}`,
            );
          }
        }
      }

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
    plan:
      | 'free'
      | 'pro'
      | 'premium'
      | 'cricket'
      | 'pickleball'
      | 'padel'
      | null;
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
        return {
          active: false,
          plan: null,
          paid_at: null,
          expires_at: null,
          payment_id: null,
        };
      }

      // Plan-style purchases have `expires_at == null` (lifetime). Order-style purchases
      // (recording access) keep their 30-min order TTL in `expires_at`; ignore those for plans.
      // For now, treat any completed MEDIA_ACCESS as "active".
      const desc = (payment.description || '').toLowerCase();
      let plan:
        | 'free'
        | 'pro'
        | 'premium'
        | 'cricket'
        | 'pickleball'
        | 'padel'
        | null = null;
      if (desc.includes('pickleball')) plan = 'pickleball';
      else if (desc.includes('cricket')) plan = 'cricket';
      else if (desc.includes('padel')) plan = 'padel';
      else if (desc.includes('premium')) plan = 'premium';
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
      return {
        active: false,
        plan: null,
        paid_at: null,
        expires_at: null,
        payment_id: null,
      };
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
          payment_type: In([
            PaymentType.RECORDING_ACCESS,
            PaymentType.HIGHLIGHT_ACCESS,
          ]),
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

  /**
   * Group-unlock view for the mobile app.
   *
   * Returns the IDs of every recording the user has access to (they own it,
   * OR someone — including a Find-My-Recording claim — shared it with them)
   * that has at least one COMPLETED payment of type RECORDING_ACCESS or
   * HIGHLIGHT_ACCESS, by any user.
   *
   * The Recordings screen calls this so that the lock icon flips to "open"
   * the moment a single group member completes payment — even if a different
   * user actually paid.
   */
  async getUnlockedRecordingIdsForUser(userId: string): Promise<string[]> {
    try {
      // 1. Recording IDs visible to this user (owner + shared with).
      const ownedRows = await this.recordingRepository.find({
        where: { userId },
        select: ['id'],
      });
      const sharedRows = await this.sharedRecordingRepository.find({
        where: { shared_with_user_id: userId },
        select: ['recording_id'],
      });

      const visibleIds = new Set<string>();
      for (const r of ownedRows) {
        if (r?.id) visibleIds.add(String(r.id));
      }
      for (const s of sharedRows) {
        if (s?.recording_id) visibleIds.add(String(s.recording_id));
      }
      if (visibleIds.size === 0) return [];

      // 2. Of those, find the ones with any completed RECORDING_ACCESS or
      //    HIGHLIGHT_ACCESS payment (from anyone in the group).
      const paid = await this.paymentRepository
        .createQueryBuilder('payment')
        .select('DISTINCT payment.recording_id', 'recording_id')
        .where('payment.recording_id IN (:...ids)', {
          ids: [...visibleIds],
        })
        .andWhere('payment.status = :completed', {
          completed: PaymentStatus.COMPLETED,
        })
        .andWhere('payment.payment_type IN (:...types)', {
          types: [PaymentType.RECORDING_ACCESS, PaymentType.HIGHLIGHT_ACCESS],
        })
        .getRawMany<{ recording_id: string }>();

      return paid.map((p) => String(p.recording_id ?? '')).filter((id) => !!id);
    } catch (error) {
      this.logger.error(
        'Failed to compute unlocked recording ids for user',
        error,
      );
      return [];
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
