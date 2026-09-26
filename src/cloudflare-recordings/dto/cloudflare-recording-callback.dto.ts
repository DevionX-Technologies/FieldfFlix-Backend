import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** One completed part, as reported by the device after a multipart upload. */
export class MultipartPartDto {
  @ApiProperty({ description: '1-based part number' })
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber: number;

  @ApiProperty({ description: 'ETag returned by R2 for this part' })
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CloudflareRecordingCallbackDto {
  @ApiProperty({ description: 'Recording UUID' })
  @IsString()
  @IsNotEmpty()
  recordingId: string;

  @ApiProperty({ enum: ['SUCCESS', 'FAILED'] })
  @IsIn(['SUCCESS', 'FAILED'])
  status: 'SUCCESS' | 'FAILED';

  @ApiPropertyOptional({ description: 'R2 object key' })
  @IsOptional()
  @IsString()
  r2Key?: string;

  @ApiPropertyOptional({ description: 'Extracted object size in bytes' })
  @IsOptional()
  @IsNumber()
  fileSizeBytes?: number;

  @ApiPropertyOptional({ description: 'Measured video duration in seconds' })
  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  @ApiPropertyOptional({ description: 'Failure reason' })
  @IsOptional()
  @IsString()
  error?: string;

  @ApiPropertyOptional({ description: 'ISO timestamp: NVR download finished' })
  @IsOptional()
  @IsISO8601()
  nvrDownloadCompletedAt?: string;

  @ApiPropertyOptional({ description: 'ISO timestamp: R2 upload started' })
  @IsOptional()
  @IsISO8601()
  uploadStartedAt?: string;

  @ApiPropertyOptional({ description: 'ISO timestamp: R2 upload finished' })
  @IsOptional()
  @IsISO8601()
  uploadCompletedAt?: string;

  @ApiPropertyOptional({
    description:
      'R2 multipart upload id. When present the backend completes the upload ' +
      'from `parts` instead of assuming a single-shot PUT already landed.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  uploadId?: string;

  @ApiPropertyOptional({
    description:
      'Completed parts for a multipart upload (ordered by partNumber)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MultipartPartDto)
  parts?: MultipartPartDto[];

  @ApiPropertyOptional({
    description: 'Parts the device failed and retried; used for telemetry',
  })
  @IsOptional()
  @IsNumber()
  retriedPartCount?: number;

  @ApiPropertyOptional({
    description: 'Parts still missing after retries, for observability',
  })
  @IsOptional()
  @IsNumber()
  failedPartCount?: number;
}
