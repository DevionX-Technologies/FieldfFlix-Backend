import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'fieldflicks-backend-alive-2026-05-13';
  }
}
