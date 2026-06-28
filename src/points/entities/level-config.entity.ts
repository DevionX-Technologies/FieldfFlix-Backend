import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Admin-configurable level increments.
 *
 * Each level requires a minimum number of points.
 * Admin can add, remove or modify levels.
 */
@Entity('level_configs')
export class LevelConfig {
  @PrimaryColumn({ type: 'integer' })
  level: number;

  @Column({ type: 'integer' })
  minPoints: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
