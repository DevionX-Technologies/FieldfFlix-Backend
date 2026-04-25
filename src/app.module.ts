import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SharedMediaRootController } from './shared-media-root.controller';
import { RequestLoggerMiddleware } from './middleware/request-logger.middleware';
import { RawBodyMiddleware } from './middleware/raw-body.middleware';
import envConfig from './env.config';
import { HealthModule } from './health/health.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from 'db/data-source';
import { AppLogger } from './logger.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { MediaUploadModule } from './media-upload/media-upload.module';
import { TurfsModule } from './turfs/turfs.module';
import { FileServiceModule } from './file-service/file-service.module';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CommonModule } from './common/common.module';
import { NotificationModule } from './notification/notification.module';
import { CameraModule } from './camera/camera.module';
import { RecordingModule } from './recording/recording.module';
import { MuxModule } from './mux/mux.module';
import { PaymentModule } from './payment/payment.module';
import { ClipProcessingModule } from './clip-processing/clip-processing.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(dataSourceOptions),
    ScheduleModule.forRoot(),
    HealthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [envConfig],
      envFilePath: envConfig().envFilePath,
    }),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRE_TIME'),
        },
      }),
      inject: [ConfigService],
    }),

    AuthModule,
    UserModule,
    MediaUploadModule,
    TurfsModule,
    NotificationModule,
    FileServiceModule,
    CommonModule,
    CameraModule,
    RecordingModule,
    MuxModule,
    PaymentModule,
    ClipProcessingModule,
  ],
  controllers: [AppController, SharedMediaRootController],
  providers: [
    AppService,
    AppLogger,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RawBodyMiddleware)
      .forRoutes({ path: 'webhooks/mux', method: RequestMethod.POST })
      .apply(RequestLoggerMiddleware)
      .forRoutes('*');
  }
}
