import { Module, Global } from '@nestjs/common';
import { MediaFeatureFlagsService } from './services/media-feature-flags.service';
import { MediaProviderFactory } from './services/media-provider-factory.service';
import { MuxLiveAdapter } from './adapters/mux-live.adapter';
import { MuxVodAdapter } from './adapters/mux-vod.adapter';
import { AwsS3StorageAdapter } from './adapters/aws-s3-storage.adapter';
import { CloudflareR2StorageAdapter } from './adapters/cloudflare-r2-storage.adapter';
import { CloudflareStreamLiveAdapter } from './adapters/cloudflare-stream-live.adapter';
import { CloudflareStreamVodAdapter } from './adapters/cloudflare-stream-vod.adapter';
import { MuxModule } from '../mux/mux.module';
import { FileServiceModule } from '../file-service/file-service.module';

import { TypeOrmModule } from '@nestjs/typeorm';
import { Recording } from '../recording/entities/recording.entity';
import { RecordingHighlights } from '../recording/entities/recording-highlights.entity';
import { ExtractionJobProgressModule } from '../extraction-queue/extraction-job-progress.module';
import { PaymentModule } from '../payment/payment.module';
import { CommonModule } from '../common/common.module';

import { CloudflareWebhookService } from './services/cloudflare-webhook.service';
import { CloudflareWebhookController } from './controllers/cloudflare-webhook.controller';
import { CloudflarePlaybackTokenService } from './services/cloudflare-playback-token.service';
import { MediaPlaybackAuthorizationService } from './services/media-playback-authorization.service';
import { MediaObservabilityService } from './services/media-observability.service';
import { MediaPlaybackController } from './controllers/media-playback.controller';

@Global()
@Module({
  imports: [
    MuxModule,
    FileServiceModule,
    PaymentModule,
    CommonModule,
    ExtractionJobProgressModule,
    TypeOrmModule.forFeature([Recording, RecordingHighlights]),
  ],
  controllers: [CloudflareWebhookController, MediaPlaybackController],
  providers: [
    MediaFeatureFlagsService,
    MediaProviderFactory,
    MuxLiveAdapter,
    MuxVodAdapter,
    AwsS3StorageAdapter,
    CloudflareR2StorageAdapter,
    CloudflareStreamLiveAdapter,
    CloudflareStreamVodAdapter,
    CloudflareWebhookService,
    CloudflarePlaybackTokenService,
    MediaPlaybackAuthorizationService,
    MediaObservabilityService,
  ],
  exports: [
    MediaFeatureFlagsService,
    MediaProviderFactory,
    MuxLiveAdapter,
    MuxVodAdapter,
    AwsS3StorageAdapter,
    CloudflareR2StorageAdapter,
    CloudflareStreamLiveAdapter,
    CloudflareStreamVodAdapter,
    CloudflareWebhookService,
    CloudflarePlaybackTokenService,
    MediaPlaybackAuthorizationService,
    MediaObservabilityService,
  ],
})
export class MediaProviderModule {}
