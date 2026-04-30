import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserService } from 'src/user/user.service';
import { Repository } from 'typeorm';
import { extractDataFromToken } from 'src/utils/utils';
import { JwtService } from '@nestjs/jwt';
import { SingUpType } from './enum/auth.enum';
import { FileServiceService } from 'src/file-service/file-service.service';
import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { NotificationType, MessageStatus } from 'src/constant/enum';
import { AppleAuthCallbackDto } from './dto/auth.dto';
import { Fast2SmsService } from 'src/common/service/fast2sms.service';
import { PhoneOtpStore } from 'src/common/service/phone-otp.store';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly userService: UserService,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    private readonly jwtService: JwtService,
    private readonly fileService: FileServiceService,
    private readonly fast2Sms: Fast2SmsService,
    private readonly phoneOtpStore: PhoneOtpStore,
  ) {}

  /** Sends a 6-digit OTP via Fast2SMS (DLT) and stores it for verification. */
  async sendOtp(mobile: string): Promise<{ message: string }> {
    this.logger.log(`send-otp (Fast2SMS) — …${mobile.replace(/\D/g, '').slice(-4)}`);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.fast2Sms.sendDltOtp(mobile, code);
    this.phoneOtpStore.set(mobile, code);
    return { message: 'OTP sent to your phone number' };
  }

  async accountExistsByPhone(mobile: string): Promise<{ exists: boolean }> {
    const phoneNumber = mobile.startsWith('+') ? mobile : `+${mobile}`;
    const user = await this.userService.findUserPhoneNumberOrEmail({
      phone_number: phoneNumber,
    });
    return { exists: !!user };
  }

  /** Verifies the OTP, then issues the app JWT. */
  async verifyOtp(mobile: string, otp: string): Promise<{
    token: string;
    isFirstTimeLogin: boolean;
    name: string;
    phone_number: string;
    profile_image_path: string;
  }> {
    if (!this.phoneOtpStore.verifyAndConsume(mobile, otp)) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Format phone number with + prefix for storage
    const phoneNumber = mobile.startsWith('+') ? mobile : `+${mobile}`;

    // Find or create user by phone number
    let isFirstTimeLogin = false;
    let user = await this.userService.findUserPhoneNumberOrEmail({
      phone_number: phoneNumber,
    });

    if (!user) {
      user = await this.userService.create({
        phone_number: phoneNumber,
        singUp_Method: SingUpType.PHONE_NUMBER,
      });
      isFirstTimeLogin = true;
    }

    // Check if user already has a welcome notification
    const existingWelcomeNotification =
      await this.notificationRepository.findOne({
        where: {
          user_id: user.id,
          notification_type: NotificationType.WELCOME_MESSAGE,
          is_soft_delete: false,
        },
      });

    // Create welcome notification for first-time users
    if (!existingWelcomeNotification) {
      await this.notificationRepository.save({
        user_id: user.id,
        title: 'Welcome to FieldFlicks! 💚',
        body: "Here, your game gets the spotlight it deserves! No more 'BRO, YOU HAD TO BE THERE' moments. Every epic play is now on record! 🎥",
        data: [],
        message_status: MessageStatus.UNREAD,
        notification_type: NotificationType.WELCOME_MESSAGE,
        is_soft_delete: false,
      });
    }

    const token = await this.generateAuthToken({ user_id: user.id });

    let profile_image_path: string;
    if (user.bucket_name && user.profile_image_path) {
      profile_image_path = await this.fileService.getSignedUrlFromS3(
        user.profile_image_path,
        user.bucket_name,
      );
    } else {
      profile_image_path = user.profile_image_path;
    }

    return {
      token,
      isFirstTimeLogin,
      name: user.name,
      phone_number: user.phone_number,
      profile_image_path,
    };
  }

  async generateAuthToken(user: any): Promise<string> {
    const token = this.jwtService.sign(user, {
      expiresIn: process.env.JWT_EXPIRATION,
      secret: process.env.JWT_SECRET,
    });
    return token;
  }

  async processGoogleUser(user: {
    email: string;
    name: string;
    picture?: string;
  }) {
    const existingUser = await this.userService.findUserPhoneNumberOrEmail({
      email: user.email,
    });

    const createdUser =
      existingUser ||
      (await this.userService.create({
        email: user.email,
        name: user.name,
        singUp_Method: SingUpType.EMAIL,
        profile_image_path: user.picture,
      }));

    const token = await this.generateAuthToken({ user_id: createdUser.id });

    // Create welcome notification for first-time users
    if (!existingUser) {
      const title = 'Welcome to FieldFlicks! 💚';
      const body =
        "Here, your game gets the spotlight it deserves! No more 'BRO, YOU HAD TO BE THERE' moments. Every epic play is now on record! 🎥";
      const notificationType = NotificationType.WELCOME_MESSAGE;
      const data = [];

      await this.notificationRepository.save({
        user_id: createdUser.id,
        title,
        body,
        data,
        message_status: MessageStatus.UNREAD,
        notification_type: notificationType,
        is_soft_delete: false,
      });
    }

    let profile_image_path: string;

    if (createdUser.bucket_name && createdUser.profile_image_path) {
      const signedUrl = await this.fileService.getSignedUrlFromS3(
        createdUser.profile_image_path,
        createdUser.bucket_name,
      );
      profile_image_path = signedUrl;
    } else {
      profile_image_path = createdUser.profile_image_path;
    }

    return {
      token,
      isFirstTimeLogin: !existingUser,
      name: createdUser.name,
      email: createdUser.email,
      phone_number: createdUser.phone_number,
      profile_image_path: profile_image_path,
    };
  }

  async googleCallback(req: any): Promise<{
    token: string;
    isFirstTimeLogin: boolean;
    name: string;
    email: string;
    phone_number: string;
    profile_image_path: string;
  }> {
    const { email, name, picture } = req.user;
    return this.processGoogleUser({ email, name, picture });
  }

  async googleMobileLoginSignup(idToken: string): Promise<{
    token: string;
    isFirstTimeLogin: boolean;
    name: string;
    email: string;
    phone_number: string;
    profile_image_path: string;
  }> {
    try {
      const googlePayload = extractDataFromToken(idToken);

      if (!googlePayload?.email) {
        throw new BadRequestException('Google token does not contain an email');
      }

      this.logger.log(
        `Processing Google mobile login for email: ${googlePayload.email}`,
      );

      return this.processGoogleUser({
        email: googlePayload.email,
        name: googlePayload.name || googlePayload.given_name,
        picture: googlePayload.picture,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async appleCallback(appleAuthCallbackDto: AppleAuthCallbackDto): Promise<{
    token: string;
    isFirstTimeLogin: boolean;
    name: string;
    email: string;
    phone_number: string | null;
    profile_image_path: string | null;
  }> {
    // Destructure necessary fields from the input body
    const { email, fullName, identityToken } = appleAuthCallbackDto;
    let identityPayload: Record<string, any> | null = null;

    let resolvedEmail = email || null;

    if (identityToken && !resolvedEmail) {
      identityPayload = extractDataFromToken(identityToken);
      resolvedEmail = identityPayload?.email;
    }

    // Check if user already exists
    const existingUser = await this.userService.findUserPhoneNumberOrEmail({
      email: resolvedEmail,
    });

    let isFirstTimeLogin = false;
    let user;

    if (!existingUser) {
      // Create new user if not exists
      user = await this.userService.create({
        email: resolvedEmail || null,
        name: fullName
          ? `${fullName.givenName || ''} ${fullName.familyName || ''}`.trim()
          : resolvedEmail.split('@')[0],
        profile_image_path: null,
        phone_number: null,
        bucket_name: null,
        singUp_Method: SingUpType.APPLE,
      });

      isFirstTimeLogin = true;

      const title = 'Welcome to FieldFlicks!';
      const notificationBody =
        "Here, your game gets the spotlight it deserves! No more 'BRO, YOU HAD TO BE THERE' moments. Every epic play is now on record! 🎥";
      const notificationType = NotificationType.WELCOME_MESSAGE;
      const data = [];

      await this.notificationRepository.save({
        user_id: user?.id,
        title,
        body: notificationBody,
        data,
        message_status: MessageStatus.UNREAD,
        notification_type: notificationType,
        is_soft_delete: false,
      });
    } else {
      user = existingUser;
    }

    // Generate JWT Token with user_id
    const token = await this.generateAuthToken({ user_id: user?.id });

    // Attempt to get signed profile image if bucket_name/profile_image_path set
    let profile_image_path: string | null = null;
    if (user?.bucket_name && user?.profile_image_path) {
      profile_image_path = await this.fileService.getSignedUrlFromS3(
        user?.profile_image_path,
        user?.bucket_name,
      );
    } else if (user?.profile_image_path) {
      profile_image_path = user?.profile_image_path;
    }

    return {
      token,
      isFirstTimeLogin,
      name: user?.name || null,
      email: user?.email || null,
      phone_number: user?.phone_number || null,
      profile_image_path: profile_image_path || null,
    };
  }
}
