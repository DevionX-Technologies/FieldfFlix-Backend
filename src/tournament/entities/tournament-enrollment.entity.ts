import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TournamentEntity } from './tournament.entity';
import { User } from '../../user/entities/user.entity';

@Entity('tournament_enrollments')
export class TournamentEnrollmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tournamentId: string;

  @ManyToOne(() => TournamentEntity)
  @JoinColumn({ name: 'tournamentId' })
  tournament: TournamentEntity;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', nullable: true })
  paymentId: string; // Razorpay payment order ID if applicable

  @CreateDateColumn({ type: 'timestamp' })
  enrolledAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
