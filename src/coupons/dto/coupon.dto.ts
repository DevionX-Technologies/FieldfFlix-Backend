import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCouponDto {
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRecordings: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRecordings?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class AssignCouponDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  note?: string;
}

export class PreviewCouponDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  basePriceInr: number;
}

export class UpsertAutoRuleDto {
  @IsIn(['weekly', 'monthly'])
  period: 'weekly' | 'monthly';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  rank: number;

  @IsUUID()
  couponId: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
