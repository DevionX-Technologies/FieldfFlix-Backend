import { Controller, Get } from '@nestjs/common';
import { Public } from 'src/decorators/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  async check() {
    const result = await this.healthService.check();
    return {
      ...result,
      service: 'FieldFlicks',
      probe: 'fieldflicks-health-probe-2026-05-14',
    };
  }
}
