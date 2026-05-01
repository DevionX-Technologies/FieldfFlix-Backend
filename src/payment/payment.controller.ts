import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  HttpException,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import {
  CreatePlanOrderDto,
  VerifyPaymentDto,
  PaymentVerificationResponseDto,
} from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentEntity } from './entities/payment.entity';

/**
 * Payment controller for handling payment operations
 */
@ApiTags('payments')
@Controller('payments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * Verify payment
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify payment',
    description: 'Verify payment signature and update payment status',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment verified successfully',
    type: PaymentVerificationResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid payment signature',
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
  })
  async verifyPayment(
    @Request() req: any,
    @Body() verifyPaymentDto: VerifyPaymentDto,
  ): Promise<PaymentVerificationResponseDto> {
    return this.paymentService.verifyPayment(
      req.user.user_id,
      verifyPaymentDto,
    );
  }

  /**
   * Create Razorpay order for premium plan (in-app “Upgrade your plan” checkout).
   */
  @Post('plan/create-order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create order for plan upgrade',
    description: 'Returns `razorpay_order_id` for client-side Checkout',
  })
  @ApiResponse({ status: 200, description: 'Order created' })
  async createPlanOrder(
    @Request() req: any,
    @Body(ValidationPipe) body: CreatePlanOrderDto,
  ) {
    return this.paymentService.createPlanOrder(req.user.user_id, body.plan);
  }

  /**
   * Get user's payment history
   */
  @Get('history')
  @ApiOperation({
    summary: 'Get payment history',
    description: 'Get all payments made by the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment history retrieved successfully',
    type: [PaymentEntity],
  })
  async getPaymentHistory(@Request() req: any): Promise<PaymentEntity[]> {
    return this.paymentService.getUserPaymentHistory(req.user.user_id);
  }

  /**
   * Returns the user's currently active premium plan, if any.
   * The mobile client uses this as the source-of-truth entitlement for
   * gating the 2.5-minute video preview vs. full playback.
   */
  @Get('plan/active')
  @ApiOperation({
    summary: 'Get active plan',
    description:
      'Returns { active, plan, paid_at, expires_at } based on the latest completed MEDIA_ACCESS payment for the user.',
  })
  @ApiResponse({ status: 200, description: 'Active plan retrieved' })
  async getActivePlan(@Request() req: any): Promise<{
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
    return this.paymentService.getActivePlan(req.user.user_id);
  }

  /**
   * Get payment details by ID
   */
  @Get(':paymentId')
  @ApiOperation({
    summary: 'Get payment details',
    description: 'Get details of a specific payment',
  })
  @ApiParam({
    name: 'paymentId',
    description: 'Payment ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment details retrieved successfully',
    type: PaymentEntity,
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
  })
  async getPaymentById(
    @Request() req: any,
    @Param('paymentId') paymentId: string,
  ): Promise<PaymentEntity> {
    return this.paymentService.getPaymentById(paymentId, req.user.user_id);
  }

  /**
   * Check if user has paid for specific content
   */
  @Get('check-access/:recordingId')
  @ApiOperation({
    summary: 'Check recording access',
    description: 'Check if user has paid for accessing a specific recording',
  })
  @ApiParam({
    name: 'recordingId',
    description: 'Recording ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Access status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        hasAccess: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  async checkRecordingAccess(
    @Request() req: any,
    @Param('recordingId') recordingId: string,
  ): Promise<{ hasAccess: boolean; message: string }> {
    const hasAccess = await this.paymentService.hasUserPaidForContent(
      req.user.user_id,
      recordingId,
    );

    return {
      hasAccess,
      message: hasAccess
        ? 'User has access to this recording'
        : 'User needs to pay to access this recording',
    };
  }

  /**
   * Refund a payment
   */
  @Post(':paymentId/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refund payment',
    description: 'Refund a completed payment',
  })
  @ApiParam({
    name: 'paymentId',
    description: 'Payment ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment refunded successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Payment cannot be refunded',
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
  })
  async refundPayment(
    @Request() req: any,
    @Param('paymentId') paymentId: string,
    @Body('amount') amount?: number,
  ): Promise<any> {
    return this.paymentService.refundPayment(
      paymentId,
      req.user.user_id,
      amount,
    );
  }

  /**
   * Create payment order for recording access
   */
  @Post(':recordingId/create-payment')
  @ApiOperation({
    summary: 'Create payment order for recording',
    description: 'Create a payment order for accessing a recording',
  })
  @ApiParam({
    name: 'recordingId',
    description: 'Recording ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment order created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid duration or already paid',
  })
  async createRecordingPaymentOrder(
    @Request() req: any,
    @Param('recordingId') recordingId: string,
  ) {
    try {
      return await this.paymentService.createPaymentOrderForRecording(
        req,
        recordingId,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to create payment order',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
