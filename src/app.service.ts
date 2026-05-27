import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private static readonly VERSION = '1.2';

  getHello(): string {
    const dateLabel = new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    const stamp = new Date().toISOString();
    return `FieldFlix API is up — ${dateLabel} IST — build ${AppService.VERSION} — ${stamp}.`;
  }
}
