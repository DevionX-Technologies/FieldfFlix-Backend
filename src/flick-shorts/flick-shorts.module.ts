import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from 'src/admin/admin.module';
import { UserModule } from 'src/user/user.module';
import { Recording } from 'src/recording/entities/recording.entity';
import { FlickShort } from './entities/flick-short.entity';
import { FlickShortsService } from './flick-shorts.service';
import { FlickShortsController } from './flick-shorts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FlickShort, Recording]), UserModule, AdminModule],
  providers: [FlickShortsService],
  controllers: [FlickShortsController],
  exports: [FlickShortsService],
})
export class FlickShortsModule {}
