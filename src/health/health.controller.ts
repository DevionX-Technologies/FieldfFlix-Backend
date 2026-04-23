import { Controller, Get } from '@nestjs/common';
import { Public } from 'src/decorators/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  async check() {
    return this.healthService.check(); // Use the health service to check health status
  }
}
