import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pricing_configs')
export class PricingConfigEntity {
  @PrimaryColumn({ type: 'varchar', length: 50, default: 'default' })
  id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 300 })
  cricket_hourly_rate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 200 })
  pickleball_hourly_rate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 250 })
  padel_hourly_rate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 250 })
  default_hourly_rate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 100 })
  highlight_base_price: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 50 })
  shorts_base_price: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0.18 })
  gst_rate: number;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
