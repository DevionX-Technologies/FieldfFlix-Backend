import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CommonService } from './service/common.service';
import firebaseAdminProvider from '../providers/firebase-admin.provider';
import razorpayProvider from '../providers/razorpay.provider';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDevicesTokenEntity } from 'src/user/entities/user-devices-token.entity';
import { FireBaseNotificationService } from './service/fire-base.service';
import { Msg91Service } from './service/msg91.service';
import { Fast2SmsService } from './service/fast2sms.service';
import { PhoneOtpStore } from './service/phone-otp.store';
import { RazorpayService } from './service/razorpay.service';
import { ConfigModule } from '@nestjs/config';
@Module({
  imports: [
    TypeOrmModule.forFeature([UserDevicesTokenEntity]),
    ConfigModule,
    JwtModule.registerAsync({
      useFactory: async () => ({
        secret: process.env.JWT_SECRET,
        signOptions: {
          expiresIn: process.env.JWT_EXPIRATION,
        },
      }),
    }),
  ],
  providers: [
    CommonService,
    FireBaseNotificationService,
    Msg91Service,
    Fast2SmsService,
    PhoneOtpStore,
    RazorpayService,
    firebaseAdminProvider,
    razorpayProvider,
  ],
  exports: [
    FireBaseNotificationService,
    Msg91Service,
    Fast2SmsService,
    PhoneOtpStore,
    CommonService,
    RazorpayService,
    firebaseAdminProvider,
  ],
})
export class CommonModule {}
