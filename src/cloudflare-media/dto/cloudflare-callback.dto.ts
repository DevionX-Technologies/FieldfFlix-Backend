import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CloudflareCallbackDto {
  @ApiProperty({
    description: 'Extraction status reported by the Raspberry Pi bridge',
    example: 'SUCCESS',
  })
  @IsString()
  @IsNotEmpty()
  status: 'SUCCESS' | 'FAILED' | string;

  @ApiProperty({
    description: 'Recording UUID',
    example: 'd9b73f8a-9231-482a-a92c-68149adbc952',
  })
  @IsString()
  @IsNotEmpty()
  recordingId: string;

  @ApiProperty({
    description: 'Object key where the MP4 was written in the R2 bucket',
    example:
      'recordings/d9b73f8a-9231-482a-a92c-68149adbc952_20260924120000.mp4',
    required: false,
  })
  @IsString()
  @IsOptional()
  r2Key?: string;

  @ApiProperty({
    description:
      'Legacy s3Key alias for backward compatibility with Pi firmware',
    required: false,
  })
  @IsString()
  @IsOptional()
  s3Key?: string;

  @ApiProperty({
    description: 'File size of the uploaded MP4 in bytes',
    example: 104857600,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  fileSizeBytes?: number;

  @ApiProperty({
    description: 'Duration of the extracted video in seconds',
    example: 3600,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  durationSeconds?: number;

  @ApiProperty({
    description: 'Error details if status is FAILED',
    required: false,
  })
  @IsString()
  @IsOptional()
  error?: string;
}
