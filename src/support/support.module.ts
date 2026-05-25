import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportContactSubmissionEntity } from './entities/support-contact-submission.entity';
import { SupportController } from './support.controller';
import { SupportMailService } from './support-mail.service';
import { SupportService } from './support.service';

@Module({
  imports: [TypeOrmModule.forFeature([SupportContactSubmissionEntity])],
  controllers: [SupportController],
  providers: [SupportService, SupportMailService],
})
export class SupportModule {}
