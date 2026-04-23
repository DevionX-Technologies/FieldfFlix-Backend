/* eslint-disable @typescript-eslint/no-require-imports */
import { ConfigService } from '@nestjs/config';
import { RAZORPAY_CLIENT } from 'src/constant/providers.constant';

export default {
  provide: RAZORPAY_CLIENT,
  useFactory: (configService: ConfigService) => {
    // Import Razorpay using require to avoid ES module issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Razorpay = require('razorpay');

    return new Razorpay({
      key_id: configService.get<string>('RAZORPAY_KEY_ID'),
      key_secret: configService.get<string>('RAZORPAY_KEY_SECRET'),
    });
  },
  inject: [ConfigService],
};
