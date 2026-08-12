import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TournamentEntity } from './entities/tournament.entity';
import { TournamentEnrollmentEntity } from './entities/tournament-enrollment.entity';
import { TournamentService } from './tournament.service';
import { TournamentController } from './tournament.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TournamentEntity, TournamentEnrollmentEntity]),
  ],
  controllers: [TournamentController],
  providers: [TournamentService],
  exports: [TournamentService, TypeOrmModule],
})
export class TournamentModule {}
