import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * GameEntity represents a scheduled or completed game/match within a tournament.
 *
 * Lifecycle:
 *   scheduled → live → completed | cancelled
 *
 * A game links a tournament fixture to one or more recordings (via recordingId)
 * and tracks the court, camera, players, and score.
 *
 * Notes:
 * - `recordingId` is nullable until the match recording is confirmed.
 * - `fixtureRef` is the string identifier from TournamentEntity.fixtures JSONB
 *   so the existing fixtures array does not need to be restructured immediately.
 * - Cloudflare Stream UID and R2 key are stored in the parent Recording via metadata JSONB.
 */
@Entity('games')
export class GameEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK to tournaments table */
  @Index('idx_games_tournament_id')
  @Column({ type: 'uuid', nullable: false })
  tournamentId: string;

  /**
   * Optional reference to the TournamentEntity.fixtures[].id or index.
   * Allows this table to coexist alongside existing JSONB fixtures
   * without requiring immediate migration of tournament fixture data.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  fixtureRef: string | null;

  /** FK to recordings table — set after the match recording is available */
  @Index('idx_games_recording_id')
  @Column({ type: 'uuid', nullable: true })
  recordingId: string | null;

  /** Court number (1-based) where this game is played */
  @Column({ type: 'int', nullable: true })
  courtNumber: number | null;

  /** FK to cameras table */
  @Column({ type: 'uuid', nullable: true })
  cameraId: string | null;

  /**
   * Round label: e.g. 'Pool Play', 'Quarterfinal', 'Semifinal', 'Final'
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  round: string | null;

  /** Team A / player A name or ID — flexible string to avoid tight coupling */
  @Column({ type: 'varchar', length: 255, nullable: true })
  teamA: string | null;

  /** Team B / player B name or ID */
  @Column({ type: 'varchar', length: 255, nullable: true })
  teamB: string | null;

  /** Optional score string, e.g. "11-7, 11-9" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  score: string | null;

  /**
   * Game status machine:
   *   scheduled → live → completed | cancelled
   */
  @Column({ type: 'varchar', length: 50, default: 'scheduled' })
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';

  /** When the game is scheduled to start */
  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  /** When live recording actually started */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  /** When the game ended */
  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  /**
   * Extra metadata — winner, sport-specific data, referee, bracket position, etc.
   * Kept as JSONB to match the pattern used throughout the codebase.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /** User who created this game entry */
  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
