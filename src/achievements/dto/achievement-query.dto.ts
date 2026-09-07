import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import {
  AchievementCategory,
  AchievementStatus,
} from '../../interface/achievement.interface';

export class AchievementQueryDto {
  @ApiPropertyOptional({
    enum: AchievementCategory,
    description:
      'Filter achievements by category (ATHLETE, CREATOR, SOCIAL, SPECIAL, LEVEL_TIER)',
  })
  @IsOptional()
  @IsEnum(AchievementCategory)
  category?: AchievementCategory;

  @ApiPropertyOptional({
    enum: AchievementStatus,
    description:
      'Filter achievements by status (LOCKED, IN_PROGRESS, UNLOCKED, CLAIMED)',
  })
  @IsOptional()
  @IsEnum(AchievementStatus)
  status?: AchievementStatus;
}
