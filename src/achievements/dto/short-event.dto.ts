import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

// =========================================================================
// Task 36: FlickShort Upload Event DTOs
// =========================================================================
export class RecordShortUploadDto {
  @ApiProperty({
    description: 'User ID of the creator who uploaded the FlickShort',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: 'Number of FlickShorts uploaded in this event (defaults to 1)',
    example: 1,
    default: 1,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  count?: number;

  @ApiPropertyOptional({
    description: 'Created FlickShort ID',
    example: 'short_123456',
  })
  @IsString()
  @IsOptional()
  shortId?: string;

  @ApiPropertyOptional({
    description: 'Source recording ID',
    example: 'rec_987654',
  })
  @IsString()
  @IsOptional()
  recordingId?: string;
}

export class ShortUploadResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({
    example: 10,
    description: 'Total lifetime FlickShorts uploaded by this creator',
  })
  totalUploaded: number;

  @ApiProperty({
    type: [String],
    example: ['CRE_HIGHLIGHT_REEL'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}

// =========================================================================
// Task 37: FlickShort Like Event DTOs
// =========================================================================
export class RecordShortLikeDto {
  @ApiProperty({
    description: 'User ID of the creator who owns the liked FlickShort',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Current total likes count on the target FlickShort',
    example: 100,
  })
  @IsNumber()
  @Min(0)
  likesCount: number;

  @ApiPropertyOptional({
    description: 'FlickShort ID',
    example: 'short_123456',
  })
  @IsString()
  @IsOptional()
  shortId?: string;
}

export class ShortLikeResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({
    example: 100,
    description: 'Highest single-short likes count achieved by this creator',
  })
  peakLikesSingleShort: number;

  @ApiProperty({
    type: [String],
    example: ['CRE_CROWD_PLEASER'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}

// =========================================================================
// Task 38: FlickShort Share Event DTOs
// =========================================================================
export class RecordShortShareDto {
  @ApiProperty({
    description: 'User ID of the creator who owns the shared FlickShort',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Current total shares count on the target FlickShort',
    example: 25,
  })
  @IsNumber()
  @Min(0)
  sharesCount: number;

  @ApiPropertyOptional({
    description: 'FlickShort ID',
    example: 'short_123456',
  })
  @IsString()
  @IsOptional()
  shortId?: string;
}

export class ShortShareResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({
    example: 25,
    description: 'Highest single-short shares count achieved by this creator',
  })
  peakSharesSingleShort: number;

  @ApiProperty({
    type: [String],
    example: ['CRE_TRENDING_CLIP'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}

// =========================================================================
// Task 39: FlickShort View Event DTOs
// =========================================================================
export class RecordShortViewDto {
  @ApiProperty({
    description: 'User ID of the creator whose FlickShort received views',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description:
      'Total views on the target FlickShort (or cumulative view count)',
    example: 10000,
  })
  @IsNumber()
  @Min(0)
  viewsCount: number;

  @ApiPropertyOptional({
    description: 'FlickShort ID',
    example: 'short_123456',
  })
  @IsString()
  @IsOptional()
  shortId?: string;
}

export class ShortViewResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({
    example: 10000,
    description: 'Highest single-short views count achieved by this creator',
  })
  peakViewsSingleShort: number;

  @ApiProperty({
    type: [String],
    example: ['CRE_REEL_LEGEND'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}
