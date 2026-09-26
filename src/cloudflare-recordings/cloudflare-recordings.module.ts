import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';

import { Recording } from '../recording/entities/recording.entity';
import { SharedRecording } from '../recording/entities/shared-recording.entity';
import { Camera } from '../camera/camera.entity';
import { CommonModule } from '../common/common.module';
import { MediaProviderModule } from '../media-provider/media-provider.module';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';
import { CloudflareRecordingsController } from './cloudflare-recordings.controller';
import { CloudflareRecordingsService } from './cloudflare-recordings.service';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    HttpModule,
    MediaProviderModule,
    TypeOrmModule.forFeature([Recording, SharedRecording, Camera]),
  ],
  controllers: [CloudflareRecordingsController],
  providers: [CloudflareRecordingsService, RaspberryPiApiService],
  exports: [CloudflareRecordingsService],
})
export class CloudflareRecordingsModule {}
