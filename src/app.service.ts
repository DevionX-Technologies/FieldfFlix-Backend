import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private static readonly VERSION = '1.3';

  getHello(): string {
    return 'FieldFlicks findmyphone is up, healthy, and accepting requests.';
  }
}
