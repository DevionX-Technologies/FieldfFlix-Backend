import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private static readonly VERSION = '1.1';

  getHello(): string {
    const dateLabel = new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    return `Backend is live on ${dateLabel}, version ${AppService.VERSION}.`;
  }
}
