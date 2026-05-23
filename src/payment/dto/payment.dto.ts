import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsUUID,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentType, PaymentStatus } from '../entities/payment.entity';

/**
 * DTO for creating a payment order
 */
export class CreatePaymentOrderDto {
  @ApiProperty({
    description: 'Amount in rupees',
    example: 240,
    minimum: 1,
    maximum: 10000,
  })
  @IsNumber()
  @Min(1)
  @Max(10000)
  amount: number;

  @ApiProperty({
    description: 'Type of payment',
    enum: PaymentType,
    example: PaymentType.RECORDING_ACCESS,
  })
  @IsEnum(PaymentType)
  payment_type: PaymentType;

  @ApiProperty({
    description: 'ID of the recording to access',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsOptional()
  recording_id?: string;

  @ApiProperty({
    description: 'ID of the media upload to access',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsOptional()
  media_upload_id?: string;

  @ApiPropertyOptional({
    description: 'Additional description for the payment',
    example: 'Payment for 1-hour video access',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Ledger base amount (e.g. pre-GST). Defaults to hourly rate for recording flows.',
    example: 200,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  base_amount?: number;
}

/** Premium / plan checkout — amounts match mobile `ProfilePremium` copy. */
export class CreatePlanOrderDto {
  @ApiProperty({
    enum: ['free', 'pro', 'premium', 'cricket', 'pickleball', 'padel'],
  })
  @IsIn(['free', 'pro', 'premium', 'cricket', 'pickleball', 'padel'])
  plan: 'free' | 'pro' | 'premium' | 'cricket' | 'pickleball' | 'padel';
}

/**
 * DTO for verifying payment
 */
export class VerifyPaymentDto {
  @ApiProperty({
    description: 'Razorpay order ID',
    example: 'order_1234567890',
  })
  @IsString()
  razorpay_order_id: string;

  @ApiProperty({
    description: 'Razorpay payment ID',
    example: 'pay_1234567890',
  })
  @IsString()
  razorpay_payment_id: string;

  @ApiProperty({
    description: 'Payment status',
    enum: PaymentStatus,
    example: PaymentStatus.COMPLETED,
  })
  @IsEnum(PaymentStatus)
  status: PaymentStatus;
}

/**
 * DTO for payment response
 */
export class PaymentResponseDto {
  @ApiProperty({
    description: 'Payment ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Razorpay order ID',
    example: 'order_1234567890',
  })
  razorpay_order_id: string;

  @ApiProperty({
    description: 'Amount in rupees',
    example: 240,
  })
  amount: number;

  @ApiProperty({
    description: 'Currency',
    example: 'INR',
  })
  currency: string;

  @ApiProperty({
    description: 'Base amount in rupees',
    example: 240,
  })
  base_amount: number;

  @ApiProperty({
    description: 'Payment status',
    enum: PaymentStatus,
    example: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @ApiProperty({
    description: 'Payment type',
    example: 'recording_access',
  })
  payment_type: string;

  @ApiProperty({
    description: 'Order creation timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Order expiry timestamp',
    example: '2024-01-01T00:30:00.000Z',
  })
  expires_at: Date;
}

/**
 * DTO for payment verification response
 */
export class PaymentVerificationResponseDto {
  @ApiProperty({
    description: 'Payment verification status',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Payment ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  payment_id: string;

  @ApiProperty({
    description: 'Razorpay payment ID',
    example: 'pay_1234567890',
  })
  razorpay_payment_id: string;

  @ApiProperty({
    description: 'Success message',
    example: 'Payment verified successfully',
  })
  message: string;
}
