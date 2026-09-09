import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class IngestMetricEventDto {
  @ApiProperty({
    description: 'User ID receiving the metric update',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Authoritative telemetry metric key to update',
    example: 'matches_played',
  })
  @IsString()
  @IsNotEmpty()
  metricKey: string;

  @ApiPropertyOptional({
    description: 'Delta amount to increment the metric by (for counter metrics)',
    example: 1,
    default: 1,
  })
  @IsNumber()
  @IsOptional()
  incrementBy?: number;

  @ApiPropertyOptional({
    description: 'Direct numeric value to set (for peak / gauge metrics)',
    example: 150,
  })
  @IsNumber()
  @IsOptional()
  value?: number;

  @ApiPropertyOptional({
    description: 'Boolean flag value (for special milestone flags)',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  flagValue?: boolean;

  @ApiPropertyOptional({
    description: 'Optional idempotency key or reference identifier to prevent duplicate processing',
    example: 'match_12345_usr_789',
  })
  @IsString()
  @IsOptional()
  refId?: string;

  @ApiPropertyOptional({
    description: 'Optional metadata dictionary for auditing or event tracing',
    example: { source: 'recording_session', courtId: 'crt_12' },
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class IngestMetricResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({ example: 'matches_played' })
  metricKey: string;

  @ApiProperty({ example: 10, description: 'New accumulated metric value' })
  currentMetricValue: number;

  @ApiProperty({
    type: [String],
    example: ['ATH_REGULAR_STARTER'],
    description: 'IDs of achievements unlocked by this metric ingestion',
  })
  unlockedAchievements: string[];
}
