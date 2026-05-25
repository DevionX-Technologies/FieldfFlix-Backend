import { Body, Controller, Post } from '@nestjs/common';
import { Public } from 'src/decorators/public.decorator';
import { SubmitSupportContactDto } from './dto/submit-support-contact.dto';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Public()
  @Post('contact')
  async submitContact(@Body() dto: SubmitSupportContactDto) {
    return this.supportService.submitContact(dto);
  }
}
