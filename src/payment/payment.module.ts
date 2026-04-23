import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentRestrictionService } from './payment-restriction.service';
import { PaymentEntity } from './entities/payment.entity';
import { User } from '../user/entities/user.entity';
import { Recording } from '../recording/entities/recording.entity';
import { MediaUploadEntity } from '../media-upload/entities/media-upload.entity';
import { RecordingHighlights } from '../recording/entities/recording-highlights.entity';
import { CommonModule } from '../common/common.module';
import { MuxModule } from '../mux/mux.module';

/**
 * Payment module for handling payment operations
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentEntity,
      User,
      Recording,
      MediaUploadEntity,
      RecordingHighlights,
    ]),
    CommonModule,
    MuxModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService, PaymentRestrictionService],
  exports: [PaymentService, PaymentRestrictionService],
})
export class PaymentModule {}
