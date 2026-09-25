import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CloudflareStartLiveStreamDto {
  @ApiProperty({
    description: 'UUID of the court camera to stream live',
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
    description: 'Physical court number',
    example: 3,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  courtNumber?: number;

  @ApiProperty({
    description: 'Optional live stream title',
    example: 'Court 3 - Botanical Gardens',
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Associated tournament UUID (if streaming for a tournament)',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  tournamentId?: string;
}

export class CloudflareStopLiveStreamDto {
  @ApiProperty({
    description: 'UUID of the court camera',
    example: '27ce1af1-721a-421c-9223-3ddeda95f325',
  })
  @IsUUID()
  @IsNotEmpty()
  cameraId: string;

  @ApiProperty({
    description: 'NVR channel number',
    example: 3,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  channel?: number;

  @ApiProperty({
    description: 'Cloudflare Live Input UID to terminate',
    required: false,
  })
  @IsString()
  @IsOptional()
  liveInputId?: string;
}
