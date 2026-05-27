import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private static readonly VERSION = '1.4';

  getHello(): string {
    return 'FieldFlicks venue-updation build is live — find-my-recording v2 (7-venue dedupe + court-number search) deployed.';
  }
}
