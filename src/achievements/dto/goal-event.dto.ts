import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class RecordGoalEventDto {
  @ApiProperty({
    description: 'User ID of the goal scorer',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Number of goals scored in this event/match',
    example: 2,
    default: 1,
  })
  @IsNumber()
  @Min(1)
  goalsCount: number;

  @ApiPropertyOptional({
    description: 'Associated match ID or recording ID',
    example: 'rec_123456',
  })
  @IsString()
  @IsOptional()
  matchId?: string;

  @ApiPropertyOptional({
    description: 'Associated highlight clip ID if goal was clipped',
    example: 'hl_789012',
  })
  @IsString()
  @IsOptional()
  highlightId?: string;
}

export class GoalEventResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({ example: 26, description: 'Updated lifetime goals scored count' })
  totalGoalsScored: number;

  @ApiProperty({
    type: [String],
    example: ['ATH_SHARP_SHOOTER'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}
