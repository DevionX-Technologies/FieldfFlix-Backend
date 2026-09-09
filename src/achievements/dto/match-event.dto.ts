import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class RecordMatchEventDto {
  @ApiProperty({
    description: 'User ID of the athlete who played the match',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: 'Unique match identifier or recording ID',
    example: 'rec_987654321',
  })
  @IsString()
  @IsOptional()
  matchId?: string;

  @ApiPropertyOptional({
    description: 'Number of matches completed in this session (defaults to 1)',
    example: 1,
    default: 1,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  matchesCount?: number;

  @ApiPropertyOptional({
    description: 'Sport played (e.g. Football, Pickleball, Cricket)',
    example: 'Football',
  })
  @IsString()
  @IsOptional()
  sport?: string;

  @ApiPropertyOptional({
    description: 'Turf / venue ID where the match occurred',
    example: 'turf_12345',
  })
  @IsString()
  @IsOptional()
  turfId?: string;
}

export class MatchEventResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({ example: 12, description: 'Updated lifetime matches played count' })
  totalMatchesPlayed: number;

  @ApiProperty({
    type: [String],
    example: ['ATH_REGULAR_STARTER'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}
