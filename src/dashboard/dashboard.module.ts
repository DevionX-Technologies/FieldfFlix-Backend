import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { User } from 'src/user/entities/user.entity';
import { RecordingEntity } from 'src/recording/entities/recording.entity';
import { TurfEntity } from 'src/turfs/entities/turfs.entity';
import { PointsModule } from 'src/points/points.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RecordingEntity, TurfEntity]),
    PointsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
