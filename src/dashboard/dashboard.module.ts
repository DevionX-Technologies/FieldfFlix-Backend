import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { User } from 'src/user/entities/user.entity';
import { Recording } from 'src/recording/entities/recording.entity';
import { TurfEntity } from 'src/turfs/entities/turfs.entity';
import { PointsModule } from 'src/points/points.module';
import { PaymentModule } from 'src/payment/payment.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Recording, TurfEntity]),
    PointsModule,
    PaymentModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
