import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TournamentEntity } from './entities/tournament.entity';
import { TournamentEnrollmentEntity } from './entities/tournament-enrollment.entity';
import { TournamentService } from './tournament.service';
import { TournamentController } from './tournament.controller';
import { PaymentModule } from '../payment/payment.module';
import { PaymentEntity } from '../payment/entities/payment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TournamentEntity,
      TournamentEnrollmentEntity,
      PaymentEntity,
    ]),
    PaymentModule,
  ],
  controllers: [TournamentController],
  providers: [TournamentService],
  exports: [TournamentService, TypeOrmModule],
})
export class TournamentModule {}
