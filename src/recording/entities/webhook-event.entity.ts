import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  mux_event_id: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  event_type?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  asset_id?: string;

  @Column({ type: 'timestamp', default: () => 'now()' })
  processed_at: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  response_status?: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;
}
