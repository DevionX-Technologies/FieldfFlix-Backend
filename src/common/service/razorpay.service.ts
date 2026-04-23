import {
  Injectable,
  Logger,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { RAZORPAY_CLIENT } from 'src/constant/providers.constant';

/**
 * Razorpay service for handling payment operations
 */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(RAZORPAY_CLIENT) private readonly razorpay: Razorpay,
  ) {}

  async createOrder(
    amount: number,
    currency: string = 'INR',
    receipt: string,
    notes?: Record<string, any>,
  ): Promise<any> {
    try {
      this.logger.log(`Creating Razorpay order for amount: ${amount} paise`);

      const order = await this.razorpay.orders.create({
        amount: amount,
        currency: currency,
        receipt: receipt,
        notes: notes || {},
      });

      this.logger.log(`Razorpay order created successfully: ${order.id}`);
      return order;
    } catch (error) {
      this.logger.error('Failed to create Razorpay order', error);
      throw new BadRequestException('Failed to create payment order');
    }
  }

  async verifyPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ): Promise<boolean> {
    try {
      this.logger.log(`Verifying payment for order: ${razorpayOrderId}`);
      const body = razorpayOrderId + '|' + razorpayPaymentId;
      // Use imported crypto module
      const expectedSignature = crypto
        .createHmac(
          'sha256',
          this.configService.get<string>('RAZORPAY_KEY_SECRET'),
        )
        .update(body.toString())
        .digest('hex');

      const isValid = expectedSignature === razorpaySignature;

      this.logger.log(`Payment verification result: ${isValid}`);
      return isValid;
    } catch (error) {
      this.logger.error('Failed to verify payment signature', error);
      return false;
    }
  }

  async getPaymentDetails(paymentId: string): Promise<any> {
    try {
      this.logger.log(`Fetching payment details for: ${paymentId}`);

      const payment = await this.razorpay.payments.fetch(paymentId);

      this.logger.log(`Payment details fetched successfully`);
      return payment;
    } catch (error) {
      this.logger.error('Failed to fetch payment details', error);
      throw new BadRequestException('Failed to fetch payment details');
    }
  }

  async getOrderDetails(orderId: string): Promise<any> {
    try {
      this.logger.log(`Fetching order details for: ${orderId}`);

      const order = await this.razorpay.orders.fetch(orderId);

      this.logger.log(`Order details fetched successfully`);
      return order;
    } catch (error) {
      this.logger.error('Failed to fetch order details', error);
      throw new BadRequestException('Failed to fetch order details');
    }
  }

  async refundPayment(
    paymentId: string,
    amount?: number,
    notes?: Record<string, any>,
  ): Promise<any> {
    try {
      this.logger.log(`Processing refund for payment: ${paymentId}`);

      const refundData: any = {
        payment_id: paymentId,
        notes: notes || {},
      };

      if (amount) {
        refundData.amount = amount;
      }

      const refund = await this.razorpay.payments.refund(paymentId, refundData);

      this.logger.log(`Refund processed successfully: ${refund.id}`);
      return refund;
    } catch (error) {
      this.logger.error('Failed to process refund', error);
      throw new BadRequestException('Failed to process refund');
    }
  }

  convertRupeesToPaise(rupees: number): number {
    return Math.round(rupees * 100);
  }

  convertPaiseToRupees(paise: number): number {
    return paise / 100;
  }
}
