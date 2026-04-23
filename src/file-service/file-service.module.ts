import { Module } from '@nestjs/common';
import { FileServiceController } from './file-service.controller';
import { FileServiceService } from './file-service.service';
import AwsS3Provider from '../providers/s3Bucket';

@Module({
  controllers: [FileServiceController],
  providers: [FileServiceService, AwsS3Provider],
  exports: [FileServiceService],
})
export class FileServiceModule {}
