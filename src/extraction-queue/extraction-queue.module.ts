import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExtractionJob } from './entities/extraction-job.entity';
import { ExtractionQueueService } from './extraction-queue.service';
import { ExtractionQueueController } from './extraction-queue.controller';
import { Recording } from '../recording/entities/recording.entity';
import { ExtractionRequest } from '../recording/entities/extraction-request.entity';
import { CloudflareRecordingsModule } from '../cloudflare-recordings/cloudflare-recordings.module';
import { ExtractionJobProgressModule } from './extraction-job-progress.module';
import { HttpModule } from '@nestjs/axios';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExtractionJob, Recording, ExtractionRequest]),
    CloudflareRecordingsModule,
    ExtractionJobProgressModule,
    CommonModule,
    HttpModule,
  ],
  controllers: [ExtractionQueueController],
  providers: [ExtractionQueueService, RaspberryPiApiService],
  exports: [ExtractionQueueService],
})
export class ExtractionQueueModule {}
