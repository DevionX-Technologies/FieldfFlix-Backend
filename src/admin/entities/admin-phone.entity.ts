import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('admin_phones')
export class AdminPhone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'phone_last_10', type: 'varchar', length: 10, unique: true })
  phoneLast10: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
