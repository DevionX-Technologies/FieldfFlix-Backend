import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordingHighlights } from 'src/recording/entities/recording-highlights.entity';
import { Recording } from 'src/recording/entities/recording.entity';
import { WebhookEvent } from 'src/recording/entities/webhook-event.entity';
import { ClipProcessingConsumer } from './clip-processing.consumer';
import { ClipProcessingProcessor } from './clip-processing.processor';
import { ClipProcessingEnqueueService } from './clip-processing.enqueue.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecordingHighlights, Recording, WebhookEvent]),
  ],
  providers: [
    ClipProcessingConsumer,
    ClipProcessingProcessor,
    ClipProcessingEnqueueService,
  ],
  exports: [ClipProcessingEnqueueService],
})
export class ClipProcessingModule {}
