import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class RecordMvpEventDto {
  @ApiProperty({
    description: 'User ID of the player awarded MVP honors',
    example: 'd3b07384-d113-4a44-8d9e-0123456789ab',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: 'Unique match identifier or recording ID',
    example: 'rec_123456',
  })
  @IsString()
  @IsOptional()
  matchId?: string;

  @ApiPropertyOptional({
    description: 'Tournament ID if MVP was awarded during tournament match',
    example: 'tourn_789',
  })
  @IsString()
  @IsOptional()
  tournamentId?: string;

  @ApiPropertyOptional({
    description: 'Number of MVP awards to add (default 1)',
    example: 1,
    default: 1,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  count?: number;
}

export class MvpEventResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'd3b07384-d113-4a44-8d9e-0123456789ab' })
  userId: string;

  @ApiProperty({ example: 5, description: 'Updated lifetime MVP honors count' })
  totalMvpMatchesCount: number;

  @ApiProperty({
    type: [String],
    example: ['ATH_MVP'],
    description: 'IDs of achievements unlocked by this event (if any)',
  })
  unlockedAchievements: string[];
}
