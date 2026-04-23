import { Module } from '@nestjs/common';
import { TurfsController } from './turfs.controller';
import { TurfsService } from './turfs.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TurfEntity } from './entities/turfs.entity';
import { TurfImageEntity } from './entities/turf-images.entity';
import { FileServiceModule } from 'src/file-service/file-service.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TurfEntity, TurfImageEntity]),
    FileServiceModule,
  ],
  controllers: [TurfsController],
  providers: [TurfsService],
})
export class TurfsModule {}
