import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsISO8601,
  Min,
} from 'class-validator';

export class CloudflareRecordingExtractDto {
  @ApiProperty({ description: 'Camera UUID' })
  @IsUUID()
  cameraId: string;

  @ApiProperty({
    description: 'Extraction start timestamp',
    example: '2026-09-25T11:15:00.000Z',
  })
  @IsISO8601()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty({
    description: 'Extraction end timestamp',
    example: '2026-09-25T11:20:00.000Z',
  })
  @IsISO8601()
  @IsNotEmpty()
  endTime: string;

  @ApiPropertyOptional({
    description: 'NVR channel; defaults to the camera court number',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  channel?: number;

  @ApiPropertyOptional({ description: 'Game or match identifier' })
  @IsOptional()
  @IsNotEmpty()
  gameId?: string;
}
