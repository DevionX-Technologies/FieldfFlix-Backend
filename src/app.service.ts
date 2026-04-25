import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'FieldFlicks — payment module (POST /payments/plan/create-order, /payments/verify).';
  }
}
