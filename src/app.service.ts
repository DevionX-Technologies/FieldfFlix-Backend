import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'fieldflicks-service-online-v3';
  }
}
