import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from 'src/admin/admin.module';
import { UserModule } from 'src/user/user.module';
import { Recording } from 'src/recording/entities/recording.entity';
import { RecordingHighlights } from 'src/recording/entities/recording-highlights.entity';
import { SharedRecording } from 'src/recording/entities/shared-recording.entity';
import { FlickShort } from './entities/flick-short.entity';
import { FlickShortsService } from './flick-shorts.service';
import { FlickShortsController } from './flick-shorts.controller';
import { PointsModule } from 'src/points/points.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FlickShort,
      Recording,
      RecordingHighlights,
      SharedRecording,
    ]),
    UserModule,
    AdminModule,
    PointsModule,
  ],
  providers: [FlickShortsService],
  controllers: [FlickShortsController],
  exports: [FlickShortsService],
})
export class FlickShortsModule {}
