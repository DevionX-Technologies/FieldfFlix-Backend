import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

// =========================================================================
// Task 40: Teammate / Social Connection Event DTOs
// =========================================================================
export class RecordTeammateConnectionDto {
  @ApiProperty({
    description: 'User ID of the player connecting with teammates',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: 'Number of newly connected teammates in this event (defaults to 1)',
    example: 1,
    default: 1,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  count?: number;

  @ApiPropertyOptional({
    description: 'Absolute total teammates connected count (if syncing full network size)',
    example: 20,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalCount?: number;

  @ApiPropertyOptional({
    description: 'User ID of the connected teammate',
    example: 'user_teammate_123',
  })
  @IsString()
  @IsOptional()
  teammateUserId?: string;

  @ApiPropertyOptional({
    description: 'Circle ID or shared match ID',
    example: 'circle_987654',
  })
  @IsString()
  @IsOptional()
  circleId?: string;
}

export class TeammateConnectionResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({
    example: 20,
    description: 'Total lifetime connected teammates for this user',
  })
  totalTeammatesConnected: number;

  @ApiProperty({
    type: [String],
    example: ['SOC_TEAM_CAPTAIN'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}

export enum SocialMetricType {
  TEAMMATES = 'teammates',
  MESSAGES = 'messages',
  REFERRALS = 'referrals',
}

export class RecordSocialEventDto {
  @ApiProperty({
    description: 'User ID of the player',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    enum: SocialMetricType,
    example: SocialMetricType.TEAMMATES,
    description: 'Type of social metric being reported (teammates, messages, referrals)',
  })
  @IsEnum(SocialMetricType)
  type: SocialMetricType;

  @ApiPropertyOptional({
    description: 'Increment count to add (defaults to 1)',
    example: 1,
    default: 1,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  count?: number;

  @ApiPropertyOptional({
    description: 'Absolute value to set (optional override)',
    example: 50,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  value?: number;
}

export class SocialEventResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({
    enum: SocialMetricType,
    example: SocialMetricType.TEAMMATES,
  })
  type: SocialMetricType;

  @ApiProperty({
    example: 50,
    description: 'Updated current metric value',
  })
  currentValue: number;

  @ApiProperty({
    type: [String],
    example: ['SOC_CLUB_LEGEND'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}
