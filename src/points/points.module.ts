import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PointEvent } from './entities/point-event.entity';
import { UserPoints } from './entities/user-points.entity';
import { PointConfig } from './entities/point-config.entity';
import { PointsService } from './points.service';
import { PointsController } from './points.controller';
import { AdminModule } from 'src/admin/admin.module';
import { UserModule } from 'src/user/user.module';

/**
 * Points & leaderboard substrate. Exports `PointsService` so other modules
 * (recording, payment, flick-shorts) can `awardPoints(...)` at the relevant
 * lifecycle hooks. Admin gating for the config endpoints reuses
 * AdminRoleService — same source of truth as the rest of the admin surface.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PointEvent, UserPoints, PointConfig]),
    AdminModule,
    UserModule,
  ],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
