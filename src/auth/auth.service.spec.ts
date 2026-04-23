import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UserService } from 'src/user/user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { JwtService } from '@nestjs/jwt';
import { Fast2SmsService } from 'src/common/service/fast2sms.service';
import { PhoneOtpStore } from 'src/common/service/phone-otp.store';
import { FileServiceService } from 'src/file-service/file-service.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const mockUserService = {};
    const mockNotificationRepository = {};
    const mockJwtService = {};
    const mockFast2Sms = { sendDltOtp: jest.fn() };
    const mockOtpStore = { set: jest.fn(), verifyAndConsume: jest.fn() };
    const mockFileServiceService = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: getRepositoryToken(NotificationEntity),
          useValue: mockNotificationRepository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: Fast2SmsService,
          useValue: mockFast2Sms,
        },
        {
          provide: PhoneOtpStore,
          useValue: mockOtpStore,
        },
        {
          provide: FileServiceService,
          useValue: mockFileServiceService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
