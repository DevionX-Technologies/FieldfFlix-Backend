import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'fieldflicks-backend-deploy-2026-01';
  }
}
