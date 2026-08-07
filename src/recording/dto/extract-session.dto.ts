import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class ExtractSessionRequestDto {
  @ApiProperty({ description: 'ID of the camera or court' })
  @IsNotEmpty()
  @IsString()
  cameraId: string;

  @ApiProperty({
    description: 'Session start timestamp (ISO 8601 UTC)',
    example: '2026-08-07T10:00:00.000Z',
  })
  @IsNotEmpty()
  @IsString()
  startTime: string;

  @ApiProperty({
    description: 'Session end timestamp (ISO 8601 UTC)',
    example: '2026-08-07T11:00:00.000Z',
  })
  @IsNotEmpty()
  @IsString()
  endTime: string;

  @ApiPropertyOptional({
    description: 'Optional game ID associated with this recording',
  })
  @IsOptional()
  @IsString()
  gameId?: string;

  @ApiPropertyOptional({ description: 'Optional user ID requesting the match' })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class PiCallbackDto {
  @ApiProperty({ description: 'Recording UUID' })
  @IsNotEmpty()
  @IsString()
  recordingId: string;

  @ApiProperty({
    description: 'Status of the extraction (SUCCESS / FAILED)',
    example: 'SUCCESS',
  })
  @IsNotEmpty()
  @IsString()
  status: 'SUCCESS' | 'FAILED' | string;

  @ApiPropertyOptional({ description: 'Target S3 object key' })
  @IsOptional()
  @IsString()
  s3Key?: string;

  @ApiPropertyOptional({ description: 'Size of the extracted file in bytes' })
  @IsOptional()
  @IsNumber()
  fileSizeBytes?: number;

  @ApiPropertyOptional({
    description: 'Duration of the extracted video in seconds',
  })
  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  @ApiPropertyOptional({ description: 'Error message if status is FAILED' })
  @IsOptional()
  @IsString()
  error?: string;
}

export class StartCourtLiveStreamDto {
  @ApiProperty({ description: 'ID of the camera or court to live stream' })
  @IsNotEmpty()
  @IsString()
  cameraId: string;
}

export class StopCourtLiveStreamDto {
  @ApiProperty({ description: 'ID of the camera or court to stop live stream' })
  @IsNotEmpty()
  @IsString()
  cameraId: string;
}
