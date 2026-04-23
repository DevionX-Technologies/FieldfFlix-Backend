import { Module } from '@nestjs/common';
import { MediaUploadController } from './media-upload.controller';
import { MediaUploadService } from './media-upload.service';
import { FileServiceModule } from 'src/file-service/file-service.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaUploadEntity } from './entities/media-upload.entity';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [
    FileServiceModule,
    CommonModule,
    TypeOrmModule.forFeature([MediaUploadEntity]),
  ],
  controllers: [MediaUploadController],
  providers: [MediaUploadService],
})
export class MediaUploadModule {}
