import { ApiProperty } from '@nestjs/swagger';
import {
  AchievementCategory,
  AchievementStatus,
  AchievementTier,
  IAchievementSummary,
  IClaimAchievementResponse,
  IGetAchievementsResponse,
  IUserAchievementItem,
} from '../../interface/achievement.interface';

export class UserAchievementItemDto implements IUserAchievementItem {
  @ApiProperty({ example: 'ATH_TURF_DEBUT', description: 'Unique achievement identifier' })
  id: string;

  @ApiProperty({
    enum: AchievementCategory,
    example: AchievementCategory.ATHLETE,
    description: 'Category taxonomy',
  })
  category: AchievementCategory;

  @ApiProperty({
    enum: AchievementTier,
    example: AchievementTier.BRONZE,
    description: 'Tier progression level',
  })
  tier: AchievementTier;

  @ApiProperty({ example: 'Turf Debut', description: 'Display title' })
  title: string;

  @ApiProperty({
    example: 'Play and complete your first match on a FieldFlicks enabled turf.',
    description: 'Detailed description of milestone',
  })
  description: string;

  @ApiProperty({ example: 'Play 1 Match', description: 'Action requirement label' })
  requirementText: string;

  @ApiProperty({ example: 'matches_played', description: 'Telemetry metric tracking key' })
  metricKey: string;

  @ApiProperty({ example: 1, description: 'Current user progress value' })
  currentProgress: number;

  @ApiProperty({ example: 1, description: 'Target threshold to complete milestone' })
  targetValue: number;

  @ApiProperty({
    example: 100,
    description: 'Normalized progress percentage (0 - 100 clamped)',
  })
  progressPercent: number;

  @ApiProperty({
    example: '1 / 1 Match',
    description: 'Normalized human-readable progress counter',
  })
  progressText: string;

  @ApiProperty({
    enum: AchievementStatus,
    example: AchievementStatus.UNLOCKED,
    description: 'FSM lifecycle state: LOCKED, IN_PROGRESS, UNLOCKED, CLAIMED',
  })
  status: AchievementStatus;

  @ApiProperty({ example: 100, description: 'XP reward points upon claim' })
  xpReward: number;

  @ApiProperty({ example: '+100 XP', description: 'Formatted reward label' })
  rewardValue: string;

  @ApiProperty({ example: true, description: 'Whether milestone requirement has been met' })
  isCompleted: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether XP reward has been claimed into user balance',
  })
  isRewardClaimed: boolean;

  @ApiProperty({
    example: 'bronze-picklebat.png',
    description: 'Filename key of badge artwork asset',
  })
  badgeAssetKey: string;

  @ApiProperty({
    required: false,
    example: 'https://cdn.fieldflicks.com/badges/bronze-picklebat.png',
    description: 'Optional resolved badge asset URL',
  })
  badgeUrl?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '2026-09-07T12:00:00.000Z',
    description: 'Timestamp when requirement was satisfied',
  })
  completedAt?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: null,
    description: 'Timestamp when reward was claimed',
  })
  claimedAt?: string | null;
}

export class AchievementSummaryDto implements IAchievementSummary {
  @ApiProperty({ example: 46, description: 'Total active achievement definitions in catalog' })
  totalAchievements: number;

  @ApiProperty({ example: 4, description: 'Count of completed achievements waiting to be claimed' })
  unlockedCount: number;

  @ApiProperty({ example: 8, description: 'Count of achievements currently in progress' })
  inProgressCount: number;

  @ApiProperty({ example: 34, description: 'Count of locked achievements with 0 progress' })
  lockedCount: number;

  @ApiProperty({ example: 1250, description: 'Total lifetime XP earned by user from gamification' })
  totalXpEarned: number;

  @ApiProperty({
    example: 4,
    description: 'Count of unclaimed achievement rewards requiring user claim CTA',
  })
  unclaimedRewardsCount: number;

  @ApiProperty({ example: 5, description: 'Current player progression level' })
  currentLevel: number;

  @ApiProperty({ example: 'Contender', description: 'Current player level tier title' })
  currentLevelName: string;

  @ApiProperty({
    example: 60,
    nullable: true,
    description: 'Points required to reach the next progression level',
  })
  nextLevelPoints: number | null;

  @ApiProperty({
    example: 0.75,
    description: 'Normalized progress fraction towards next level (0.0 to 1.0)',
  })
  levelProgress: number;
}

export class GetAchievementsResponseDto implements IGetAchievementsResponse {
  @ApiProperty({ type: AchievementSummaryDto, description: 'Summary gamification metrics' })
  summary: AchievementSummaryDto;

  @ApiProperty({
    type: [UserAchievementItemDto],
    description: 'List of all achievement records with normalized progress',
  })
  achievements: UserAchievementItemDto[];
}

export class ClaimAchievementResponseDto implements IClaimAchievementResponse {
  @ApiProperty({ example: 'ATH_TURF_DEBUT', description: 'Claimed achievement ID' })
  achievementId: string;

  @ApiProperty({ example: 'Turf Debut', description: 'Achievement title' })
  title: string;

  @ApiProperty({ example: 100, description: 'Amount of XP awarded' })
  xpAwarded: number;

  @ApiProperty({ example: 1350, description: 'Updated total XP balance for user' })
  newTotalXp: number;

  @ApiProperty({ example: 4, description: 'Player level prior to claim' })
  previousLevel: number;

  @ApiProperty({ example: 5, description: 'Player level after claim reward processing' })
  currentLevel: number;

  @ApiProperty({ example: 'Contender', description: 'Current level tier title' })
  currentLevelName: string;

  @ApiProperty({
    example: true,
    description: 'Flag indicating whether claiming this reward triggered a level up',
  })
  levelUpOccurred: boolean;

  @ApiProperty({
    example: '2026-09-07T12:15:00.000Z',
    description: 'ISO timestamp when claim was processed',
  })
  claimedAt: string;
}
