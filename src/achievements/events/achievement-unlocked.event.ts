import { AchievementCategory, AchievementTier } from 'src/interface/achievement.interface';

export class AchievementUnlockedEvent {
  public static readonly EVENT_NAME = 'achievement.unlocked';

  constructor(
    public readonly userId: string,
    public readonly achievementId: string,
    public readonly title: string,
    public readonly description: string,
    public readonly category: AchievementCategory,
    public readonly tier: AchievementTier,
    public readonly xpReward: number,
    public readonly badgeAssetKey: string,
    public readonly unlockedAt: Date = new Date(),
  ) {}
}
