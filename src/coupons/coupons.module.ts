import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from './entities/coupon.entity';
import { CouponAssignment } from './entities/coupon-assignment.entity';
import { CouponRedemption } from './entities/coupon-redemption.entity';
import { LeaderboardAutoRule } from './entities/leaderboard-auto-rule.entity';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { AdminModule } from 'src/admin/admin.module';
import { UserModule } from 'src/user/user.module';

/**
 * Discount layer for recording unlocks.
 *
 * Exports `CouponsService` so PaymentModule can call `previewDiscount` /
 * `redeem` inside the order-creation and verify paths.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Coupon,
      CouponAssignment,
      CouponRedemption,
      LeaderboardAutoRule,
    ]),
    AdminModule,
    UserModule,
  ],
  providers: [CouponsService],
  controllers: [CouponsController],
  exports: [CouponsService],
})
export class CouponsModule {}
