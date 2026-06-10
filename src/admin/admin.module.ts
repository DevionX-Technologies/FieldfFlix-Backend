import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordingModule } from 'src/recording/recording.module';
import { UserModule } from 'src/user/user.module';
import { AdminPhone } from './entities/admin-phone.entity';
import { AdminController } from './admin.controller';
import { AdminRoleService } from './admin-role.service';

/**
 * AdminModule sits inside a cycle now that the gamification modules import
 * AdminRoleService:
 *
 *   RecordingModule → PaymentModule → PointsModule (or CouponsModule)
 *                                      → AdminModule
 *                                        → RecordingModule (← closes the loop)
 *
 * Wrapping `RecordingModule` in `forwardRef` defers the reference so Nest can
 * finish constructing both modules without one being `undefined` at import
 * resolution time. The matching `forwardRef(() => AdminModule)` lives in
 * `PointsModule` and `CouponsModule`. AdminController also injects
 * RecordingService behind a `forwardRef` (see admin.controller.ts).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AdminPhone]),
    UserModule,
    forwardRef(() => RecordingModule),
  ],
  controllers: [AdminController],
  providers: [AdminRoleService],
  exports: [AdminRoleService, TypeOrmModule],
})
export class AdminModule {}
