import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordingModule } from 'src/recording/recording.module';
import { UserModule } from 'src/user/user.module';
import { AdminPhone } from './entities/admin-phone.entity';
import { AdminController } from './admin.controller';
import { AdminRoleService } from './admin-role.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { User } from 'src/user/entities/user.entity';
import { Recording } from 'src/recording/entities/recording.entity';
import { RecordingHighlights } from 'src/recording/entities/recording-highlights.entity';
import { PaymentEntity } from 'src/payment/entities/payment.entity';
import { TurfEntity } from 'src/turfs/entities/turfs.entity';
import { Camera } from 'src/camera/camera.entity';
import { Coupon } from 'src/coupons/entities/coupon.entity';
import { CouponAssignment } from 'src/coupons/entities/coupon-assignment.entity';
import { UserPoints } from 'src/points/entities/user-points.entity';
import { PointEvent } from 'src/points/entities/point-event.entity';

import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminPhone,
      User,
      Recording,
      RecordingHighlights,
      PaymentEntity,
      TurfEntity,
      Camera,
      Coupon,
      CouponAssignment,
      UserPoints,
      PointEvent,
      NotificationEntity,
    ]),
    UserModule,
    forwardRef(() => RecordingModule),
    CommonModule,
  ],
  controllers: [AdminController],
  providers: [AdminRoleService, AdminAnalyticsService],
  exports: [AdminRoleService, AdminAnalyticsService, TypeOrmModule],
})
export class AdminModule {}
