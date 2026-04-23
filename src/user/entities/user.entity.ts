import { SingUpType } from 'src/auth/enum/auth.enum';
import { MediaUploadEntity } from 'src/media-upload/entities/media-upload.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserDevicesTokenEntity } from './user-devices-token.entity';
import { SharedRecording } from '../../recording/entities/shared-recording.entity';
import { PaymentEntity } from '../../payment/entities/payment.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, nullable: true })
  email: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  profile_image_path: string;

  @Column({ nullable: true })
  bucket_name: string;

  @Column({ nullable: true })
  phone_number: string;

  @Column({
    type: 'enum',
    enum: SingUpType,
    nullable: true,
    enumName: 'SingUpType',
  })
  singUp_Method: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  @OneToMany(() => MediaUploadEntity, (mediaUpload) => mediaUpload.user)
  mediaUploads: MediaUploadEntity[];

  @OneToMany(() => UserDevicesTokenEntity, (ut) => ut.user)
  user_devices_token: UserDevicesTokenEntity[];

  @OneToMany(() => SharedRecording, (shared) => shared.sharedWithUser)
  receivedSharedRecordings: SharedRecording[];

  @OneToMany(() => PaymentEntity, (payment) => payment.user)
  payments: PaymentEntity[];
}
