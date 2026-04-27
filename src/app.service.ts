import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'fieldflicks-api-queue-studio-v5';
  }
}
