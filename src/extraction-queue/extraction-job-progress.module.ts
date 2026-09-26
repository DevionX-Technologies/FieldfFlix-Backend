import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExtractionJob } from './entities/extraction-job.entity';
import { Recording } from '../recording/entities/recording.entity';
import { ExtractionRequest } from '../recording/entities/extraction-request.entity';
import { ExtractionJobProgressService } from './extraction-job-progress.service';

/**
 * Deliberately does NOT import CloudflareRecordingsModule or
 * ExtractionQueueModule, so consumers on either side of the dispatcher
 * boundary can depend on it without an import cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ExtractionJob, Recording, ExtractionRequest]),
  ],
  providers: [ExtractionJobProgressService],
  exports: [ExtractionJobProgressService],
})
export class ExtractionJobProgressModule {}
