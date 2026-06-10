import { forwardRef, Module } from '@nestjs/common';
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
 *
 * AdminModule is imported behind `forwardRef` because the module graph forms
 * a cycle:
 *   AppModule → RecordingModule → PaymentModule → CouponsModule → AdminModule
 *           ← (AdminModule re-imports RecordingModule)
 * `forwardRef` defers the reference until both modules are constructed.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Coupon,
      CouponAssignment,
      CouponRedemption,
      LeaderboardAutoRule,
    ]),
    forwardRef(() => AdminModule),
    UserModule,
  ],
  providers: [CouponsService],
  controllers: [CouponsController],
  exports: [CouponsService],
})
export class CouponsModule {}
