/**
 * FieldFlicks Backend - Authoritative Achievement Data Contracts and Interfaces
 * Based on Approved Specification (FlieldFlicks_Achievements_Approval.pdf)
 * and Implementation Plan (Achievements-plan-tasks.pdf - Task 5)
 */

export enum AchievementCategory {
  ATHLETE = 'ATHLETE',
  CREATOR = 'CREATOR',
  SOCIAL = 'SOCIAL',
  SPECIAL = 'SPECIAL',
  LEVEL_TIER = 'LEVEL_TIER',
}

export enum AchievementTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
  SPECIAL = 'SPECIAL',
  BASE = 'BASE',
  GREEN = 'GREEN',
  CYAN = 'CYAN',
  AMETHYST = 'AMBER',
  AMBER = 'AMBER',
  PRESTIGE = 'PRESTIGE',
}

export enum AchievementStatus {
  LOCKED = 'LOCKED',
  IN_PROGRESS = 'IN_PROGRESS',
  UNLOCKED = 'UNLOCKED',
  CLAIMED = 'CLAIMED',
}

export interface IAchievementDefinition {
  id: string;
  category: AchievementCategory;
  tier: AchievementTier;
  title: string;
  description: string;
  requirementText: string;
  metricKey: string;
  targetValue: number;
  xpReward: number;
  badgeAssetKey: string;
  displayOrder: number;
  isActive: boolean;
}

export interface IUserAchievementItem {
  id: string;
  category: AchievementCategory;
  tier: AchievementTier;
  title: string;
  description: string;
  requirementText: string;
  metricKey: string;
  currentProgress: number;
  targetValue: number;
  progressPercent: number;
  progressText: string;
  status: AchievementStatus;
  xpReward: number;
  rewardValue: string;
  isCompleted: boolean;
  isRewardClaimed: boolean;
  badgeAssetKey: string;
  badgeUrl?: string;
  completedAt?: Date | string | null;
  claimedAt?: Date | string | null;
}

export interface IAchievementSummary {
  totalAchievements: number;
  unlockedCount: number;
  inProgressCount: number;
  lockedCount: number;
  totalXpEarned: number;
  unclaimedRewardsCount: number;
  currentLevel: number;
  currentLevelName: string;
  nextLevelPoints: number | null;
  levelProgress: number;
}

export interface IGetAchievementsResponse {
  summary: IAchievementSummary;
  achievements: IUserAchievementItem[];
}

export interface IClaimAchievementResponse {
  achievementId: string;
  title: string;
  xpAwarded: number;
  newTotalXp: number;
  previousLevel: number;
  currentLevel: number;
  currentLevelName: string;
  levelUpOccurred: boolean;
  claimedAt: string;
}

export interface IAchievementUnlockEvent {
  userId: string;
  achievementId: string;
  title: string;
  category: AchievementCategory;
  tier: AchievementTier;
  xpReward: number;
  badgeAssetKey: string;
  unlockedAt: string;
}
