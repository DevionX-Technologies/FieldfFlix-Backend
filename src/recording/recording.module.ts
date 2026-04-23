import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordingController } from './controller/recording.controller';
import { RecordingPlaybackController } from './controller/recording-playback.controller';
import { Recording } from './entities/recording.entity';
import { CameraModule } from 'src/camera/camera.module';
import { SharedRecording } from './entities/shared-recording.entity';
import { RaspberryPiApiService } from 'src/raspberry-pi/raspberry-pi-api.service';
import { HttpModule } from '@nestjs/axios';
import { MuxModule } from 'src/mux/mux.module';
import { FileServiceModule } from 'src/file-service/file-service.module';
import { CommonModule } from 'src/common/common.module';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from 'src/user/user.module';
import { RecordingService } from './service/recording.service';
import { RecordingHighlightsService } from './service/recording-highlight.service';
import { RecordingPaymentService } from './service/recording-payment.service';
import { MuxWebhookController } from './controller/mux-webhook.controller';
import { RecordingHighlights } from './entities/recording-highlights.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { PaymentModule } from 'src/payment/payment.module';
import { ClipProcessingModule } from 'src/clip-processing/clip-processing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recording, SharedRecording, RecordingHighlights, WebhookEvent]),
    CameraModule,
    UserModule,
    HttpModule,
    MuxModule,
    FileServiceModule,
    CommonModule,
    JwtModule,
    PaymentModule,
    ClipProcessingModule,
  ],
  controllers: [
    RecordingController,
    MuxWebhookController,
    RecordingPlaybackController,
  ],
  providers: [
    RecordingService,
    RaspberryPiApiService,
    RecordingHighlightsService,
    RecordingPaymentService,
  ],
  exports: [RecordingService, RecordingPaymentService],
})
export class RecordingModule {}
