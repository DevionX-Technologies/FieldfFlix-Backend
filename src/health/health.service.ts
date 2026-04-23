import { Injectable } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  HealthCheckResult,
} from '@nestjs/terminus';

@Injectable()
export class HealthService {
  constructor(private readonly healthCheckService: HealthCheckService) {}

  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([]); // No external services for now
  }
}
