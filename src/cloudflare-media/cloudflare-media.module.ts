import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { CloudflareMediaController } from './cloudflare-media.controller';
import { CloudflareMediaService } from './cloudflare-media.service';

import { Recording } from '../recording/entities/recording.entity';
import { Camera } from '../camera/camera.entity';
import { RecordingHighlights } from '../recording/entities/recording-highlights.entity';
import { TournamentEntity } from '../tournament/entities/tournament.entity';

import { MediaProviderModule } from '../media-provider/media-provider.module';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Recording,
      Camera,
      RecordingHighlights,
      TournamentEntity,
    ]),
    HttpModule,
    ConfigModule,
    MediaProviderModule,
    CommonModule,
  ],
  controllers: [CloudflareMediaController],
  providers: [CloudflareMediaService, RaspberryPiApiService],
  exports: [CloudflareMediaService],
})
export class CloudflareMediaModule {}
