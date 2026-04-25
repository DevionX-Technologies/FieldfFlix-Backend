import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'FieldFlicks — recording updates (Mux signed playback, share deep links, /recording/:id/highlights, /payments/plan/active).';
  }
}
