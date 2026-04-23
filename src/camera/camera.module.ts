import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CameraController } from './camera.controller';
import { CameraService } from './camera.service';
import { Camera } from './camera.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Camera])],
  controllers: [CameraController],
  providers: [CameraService],
  exports: [TypeOrmModule],
})
export class CameraModule {}
