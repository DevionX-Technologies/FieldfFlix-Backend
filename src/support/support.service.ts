import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubmitSupportContactDto } from './dto/submit-support-contact.dto';
import { SupportContactSubmissionEntity } from './entities/support-contact-submission.entity';
import { SupportMailService } from './support-mail.service';

const ISSUE_LABELS: Record<string, string> = {
  bug: 'Report a Bug',
  feature: 'Suggest a Feature',
  general: 'General Query',
};

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportContactSubmissionEntity)
    private readonly repo: Repository<SupportContactSubmissionEntity>,
    private readonly supportMail: SupportMailService,
  ) {}

  async submitContact(dto: SubmitSupportContactDto): Promise<{ id: string }> {
    const fullName = dto.fullName.trim();
    const mobile = dto.mobile.replace(/\D/g, '');
    const description = dto.description.trim();

    const row = this.repo.create({
      issue_type: dto.issueType,
      full_name: fullName,
      mobile,
      description,
    });
    const saved = await this.repo.save(row);

    this.logger.log(
      `Support contact saved id=${saved.id} type=${saved.issue_type} name=${fullName} mobile=${mobile}`,
    );

    if (this.supportMail.isOutboundEnabled()) {
      try {
        await this.supportMail.sendInboundNotification({
          submissionId: saved.id,
          issueType: dto.issueType,
          issueLabel: ISSUE_LABELS[dto.issueType] ?? dto.issueType,
          fullName,
          mobile,
          description,
        });
      } catch (err) {
        this.logger.error(
          `Support SMTP failed submissionId=${saved.id}`,
          err instanceof Error ? err.stack : String(err),
        );
        throw new ServiceUnavailableException(
          'Message was saved but email delivery failed. Please try again shortly or mail admin@fieldflix.com.',
        );
      }
    }

    return { id: saved.id };
  }
}
