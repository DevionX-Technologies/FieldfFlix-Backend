import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from 'src/user/entities/user.entity';

/**
 * Aggregated real-time telemetry counters per user.
 * Enables O(1) achievement threshold evaluation without scanning event tables.
 */
@Entity('user_achievement_metrics')
export class UserAchievementMetrics {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // --- Athlete Metrics ---
  @Column({ type: 'integer', default: 0 })
  matchesPlayed: number;

  @Column({ type: 'integer', default: 0 })
  goalsScored: number;

  @Column({ type: 'integer', default: 0 })
  mvpMatchesCount: number;

  @Column({ type: 'integer', default: 0 })
  streakDays: number;

  @Column({ type: 'integer', default: 0 })
  matchWinStreak: number;

  // --- Creator Metrics ---
  @Column({ type: 'integer', default: 0 })
  flickshortsUploadedCount: number;

  @Column({ type: 'integer', default: 0 })
  peakLikesSingleShort: number;

  @Column({ type: 'integer', default: 0 })
  peakSharesSingleShort: number;

  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number | string) => value,
      from: (value: string | number) =>
        value !== null && value !== undefined ? Number(value) : value,
    },
  })
  peakViewsSingleShort: number;

  // --- Social Metrics ---
  @Column({ type: 'integer', default: 0 })
  teammatesConnectedCount: number;

  @Column({ type: 'integer', default: 999 })
  crewWatchRank: number;

  @Column({ type: 'integer', default: 0 })
  referralsCompletedCount: number;

  @Column({ type: 'integer', default: 0 })
  messagesSentCount: number;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 100.0,
    transformer: {
      to: (value: number | string) => value,
      from: (value: string | number) =>
        value !== null && value !== undefined ? Number(value) : value,
    },
  })
  socialRankPercentile: number;

  // --- Special & Platform Flags ---
  @Column({ type: 'integer', default: 0 })
  matchesRecordedCount: number;

  @Column({ type: 'integer', default: 0 })
  highlightsCreatedCount: number;

  @Column({ type: 'integer', nullable: true })
  userSignupSequence: number | null;

  @Column({ type: 'boolean', default: false })
  betaTesterFlag: boolean;

  @Column({ type: 'boolean', default: false })
  lifetimeLegendFlag: boolean;

  @Column({ type: 'boolean', default: false })
  fastStartFlag: boolean;

  @Column({ type: 'boolean', default: false })
  exceptionalCompetitiveFlag: boolean;

  @Column({ type: 'boolean', default: false })
  standoutContentFlag: boolean;

  @Column({ type: 'boolean', default: false })
  communityNotableFlag: boolean;

  @Column({ type: 'boolean', default: false })
  sustainedActivityFlag: boolean;

  @Column({ type: 'boolean', default: false })
  communityIconFlag: boolean;

  @Column({ type: 'boolean', default: false })
  legacyContributionFlag: boolean;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
