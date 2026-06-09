import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from 'src/user/entities/user.entity';

/**
 * Denormalized total-points cache, one row per user. Updated atomically
 * inside the same transaction as the PointEvent insert via
 * `PointsService.awardPoints`. Leaderboard reads should hit this table
 * (sorted by `totalPoints`) for snappy responses; period-scoped leaderboards
 * (weekly / monthly) aggregate the PointEvent table directly.
 *
 * Why a separate table over a column on `users`: keeps writes off the hot
 * users row (which is read on every authenticated request), lets us add
 * leaderboard-only indexes here without touching the user index plan.
 */
@Entity('user_points')
@Index('IDX_user_points_total', ['totalPoints'])
export class UserPoints {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'integer', default: 0 })
  totalPoints: number;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
