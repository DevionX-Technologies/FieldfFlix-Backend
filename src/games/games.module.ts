import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameEntity } from './entities/game.entity';
import { GamesService } from './games.service';
import { GamesController } from './games.controller';
import { RecordingModule } from '../recording/recording.module';
import { MediaProviderModule } from '../media-provider/media-provider.module';
import { TournamentModule } from '../tournament/tournament.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GameEntity]),
    forwardRef(() => RecordingModule),
    forwardRef(() => MediaProviderModule),
    TournamentModule,
  ],
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService, TypeOrmModule],
})
export class GamesModule {}
