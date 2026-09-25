import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CloudflareExtractSessionDto {
  @ApiProperty({
    description: 'UUID of the court camera',
    example: '27ce1af1-721a-421c-9223-3ddeda95f325',
  })
  @IsUUID()
  @IsNotEmpty()
  cameraId: string;

  @ApiProperty({
    description: 'NVR channel number on the edge device',
    example: 3,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  channel?: number;

  @ApiProperty({
    description: 'Start timestamp (ISO 8601 string)',
    example: '2026-09-24T10:00:00.000Z',
  })
  @IsString()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty({
    description: 'End timestamp (ISO 8601 string)',
    example: '2026-09-24T11:00:00.000Z',
  })
  @IsString()
  @IsNotEmpty()
  endTime: string;

  @ApiProperty({
    description:
      'User ID requesting the extraction (optional if Bearer JWT present)',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  userId?: string;

  @ApiProperty({
    description: 'Optional game or match ID associated with this session',
    required: false,
  })
  @IsString()
  @IsOptional()
  gameId?: string;
}
