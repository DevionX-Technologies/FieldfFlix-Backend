import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class RecordStreakEventDto {
  @ApiProperty({
    description: 'User ID of the player whose streak is being updated',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: 'Active consecutive active play streak days',
    example: 10,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  streakDays?: number;

  @ApiPropertyOptional({
    description: 'Consecutive match win streak count',
    example: 15,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  matchWinStreak?: number;
}

export class StreakEventResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({ example: 10, description: 'Updated daily streak days' })
  streakDays: number;

  @ApiProperty({ example: 15, description: 'Updated match win streak' })
  matchWinStreak: number;

  @ApiProperty({
    type: [String],
    example: ['ATH_CONSISTENT_PLAYER', 'SPC_HOT_STREAK'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}
