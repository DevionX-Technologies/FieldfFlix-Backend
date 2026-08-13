import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TournamentStatus =
  | 'Upcoming'
  | 'Live'
  | 'Completed'
  | 'Cancelled'
  | 'Pending_Approval';

@Entity('tournaments')
export class TournamentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100, default: 'Pickleball' })
  sport: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  bannerImage: string;

  @Column({ type: 'integer', default: 0 })
  prizePool: number;

  @Column({ type: 'timestamp', nullable: true })
  closingDate: Date;

  @Column({ type: 'varchar', length: 255, default: 'Venue Stadium' })
  venue: string;

  @Column({ type: 'uuid', nullable: true })
  turfId: string;

  /** Camera IDs assigned to this tournament (from admin fleet). */
  @Column({ type: 'jsonb', nullable: true })
  cameraIds: string[];

  /** Active / configured live streams for tournament viewers. */
  @Column({ type: 'jsonb', nullable: true })
  liveStreams: Array<{
    cameraId: string;
    cameraName: string;
    courtNumber?: number;
    playbackUrl?: string;
    isLive: boolean;
  }>;

  @Column({ type: 'varchar', length: 100, default: 'Mumbai' })
  city: string;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp', nullable: true })
  endDate: Date;

  @Column({ type: 'integer', default: 0 })
  participantsCount: number;

  @Column({ type: 'integer', default: 32 })
  maxParticipants: number;

  @Column({ type: 'integer', default: 0 })
  entryFee: number; // 0 for unpaid/free, >0 for paid

  @Column({ type: 'varchar', length: 50, default: 'Open / Intermediate' })
  skillLevel: string;

  @Column({ type: 'varchar', length: 50, default: 'All Ages' })
  ageGroup: string;

  @Column({ type: 'varchar', length: 50, default: 'Open' })
  gender: string;

  @Column({ type: 'boolean', default: true })
  isIndoor: boolean;

  @Column({ type: 'varchar', length: 50, default: 'Upcoming' })
  status: TournamentStatus;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  organizer: {
    id?: string;
    name: string;
    contactEmail: string;
    contactPhone: string;
    isVerified: boolean;
  };

  @Column({ type: 'jsonb', nullable: true })
  prizes: {
    champion: string;
    runnerUp: string;
    semiFinalists: string;
  };

  @Column({ type: 'jsonb', nullable: true })
  fixtures: Array<{
    id: string;
    court: string;
    round: string;
    teamA: string;
    teamB: string;
    startTime: string;
    status: string;
    score?: string;
  }>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
