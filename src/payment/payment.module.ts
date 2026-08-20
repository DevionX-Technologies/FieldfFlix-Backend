import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentRestrictionService } from './payment-restriction.service';
import { PaymentEntity } from './entities/payment.entity';
import { PricingConfigEntity } from './entities/pricing-config.entity';
import { PricingConfigService } from './pricing-config.service';
import { PricingConfigController } from './pricing-config.controller';
import { User } from '../user/entities/user.entity';
import { Recording } from '../recording/entities/recording.entity';
import { SharedRecording } from '../recording/entities/shared-recording.entity';
import { MediaUploadEntity } from '../media-upload/entities/media-upload.entity';
import { RecordingHighlights } from '../recording/entities/recording-highlights.entity';
import { CommonModule } from '../common/common.module';
import { PointsModule } from '../points/points.module';
import { CouponsModule } from '../coupons/coupons.module';

/**
 * Payment module for handling payment operations
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentEntity,
      PricingConfigEntity,
      User,
      Recording,
      SharedRecording,
      MediaUploadEntity,
      RecordingHighlights,
    ]),
    CommonModule,
    PointsModule,
    CouponsModule,
  ],
  controllers: [PaymentController, PricingConfigController],
  providers: [PaymentService, PaymentRestrictionService, PricingConfigService],
  exports: [PaymentService, PaymentRestrictionService, PricingConfigService],
})
export class PaymentModule {}
