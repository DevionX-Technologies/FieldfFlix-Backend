import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

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
}
