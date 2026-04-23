import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import {
  CreateUserDto,
  GetUserPhoneNumberOrEmail,
  UpdateUserDto,
} from './dto/user.dto';
import { FileServiceService } from 'src/file-service/file-service.service';
import { Request } from 'express';
import { CommonService } from 'src/common/service/common.service';
import { AWS_BUCKET_NAME, PROFILE_PIC_PATH } from 'src/constant/constant';
import { STATUS_MSG } from 'src/constant/status-message.constants';
import { UserDevicesTokenEntity } from './entities/user-devices-token.entity';
import { IStatusMessage } from 'src/interface/interface';
import { SharedRecording } from 'src/recording/entities/shared-recording.entity';
import { Recording } from 'src/recording/entities/recording.entity';
import { PaymentEntity } from 'src/payment/entities/payment.entity';
import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { MediaUploadEntity } from 'src/media-upload/entities/media-upload.entity';

@Injectable()
export class UserService {
  private readonly logger = new Logger('UserService');
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly fileService: FileServiceService,
    private readonly commonService: CommonService,
    @InjectRepository(UserDevicesTokenEntity)
    private readonly userDevicesTokenRepository: Repository<UserDevicesTokenEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create(createUserDto);
    return await this.userRepository.save(user);
  }

  async updateDeviceId(
    req: Request,
    devicesId: string,
  ): Promise<IStatusMessage> {
    const decoded = await this.commonService.extractDataFromToken(req);

    const findUseDeviceId = await this.userDevicesTokenRepository.findOne({
      where: {
        user_id: decoded.user_id,
        devices_id: devicesId,
      },
      cache: true,
    });

    if (findUseDeviceId) {
      return STATUS_MSG.SUCCESS.ADD_DEVICE_ID;
    }

    await this.userDevicesTokenRepository.save({
      user_id: decoded.user_id,
      devices_id: devicesId,
    });

    return STATUS_MSG.SUCCESS.ADD_DEVICE_ID;
  }

  async uploadProfilePic(req: any, file: Express.Multer.File): Promise<string> {
    const decode = await this.commonService.extractDataFromToken(req);
    const userProfile = await this.userRepository.findOneBy({
      id: decode.user_id,
    });

    // Check if the user has an existing profile pic and delete it

    const bucketName = userProfile.bucket_name
      ? userProfile.bucket_name
      : AWS_BUCKET_NAME;

    if (userProfile.bucket_name) {
      // Delete the existing profile pic from S3

      await this.fileService.deleteFileFormS3(
        userProfile.bucket_name,
        userProfile.profile_image_path,
      );
    }

    // 2. Generate a unique file path for the uploaded file
    const filePath = PROFILE_PIC_PATH.replace(
      ':date',
      `${new Date().getTime()}${file?.originalname}`,
    )
      .replace(':userID', decode.user_id)
      .replace(/\s/g, '')
      .toLowerCase()
      .trim();

    // 3. Upload the file to S3
    const result = await this.fileService.uploadProfileImage(
      filePath,
      file.buffer,
      file.mimetype,
      bucketName,
    );

    // 4. Throw an error if the upload fails
    if (!result.url) {
      throw new BadRequestException(STATUS_MSG.ERROR.FAILED_UPLOAD_PROFILE_PIC);
    }
    // 5. Log the successful upload and return the file path
    await this.userRepository.update(
      { id: decode.user_id },
      { profile_image_path: filePath, bucket_name: bucketName },
    );
    return result.url;
  }

  async findAll(): Promise<User[]> {
    const users = await this.userRepository.find();
    for (const user of users) {
      if (user.bucket_name && user.profile_image_path) {
        const signedUrl = await this.fileService.getSignedUrlFromS3(
          user.profile_image_path,
          user.bucket_name,
        );
        user.profile_image_path = signedUrl;
      }
    }
    return users;
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      this.logger.error('User not found');
      throw new BadRequestException('User not found');
    }
    if (user.bucket_name && user.profile_image_path) {
      const signedUrl = await this.fileService.getSignedUrlFromS3(
        user.profile_image_path,
        user.bucket_name,
      );
      user.profile_image_path = signedUrl;
    }
    return user;
  }

  async update(req: Request, updateUserDto: UpdateUserDto): Promise<User> {
    const decode = await this.commonService.extractDataFromToken(req);
    const updatedUser = await this.userRepository.update(
      { id: decode.user_id },
      { ...updateUserDto },
    );
    if (!updatedUser.affected) {
      throw new Error('Failed to update user');
    }

    const user = await this.findOne(decode.user_id);

    return user;
  }

  async updateById(
    id: string,
    data: Partial<Pick<User, 'phone_number' | 'email' | 'name'>>,
  ): Promise<User> {
    await this.userRepository.update({ id }, data);
    return this.userRepository.findOneBy({ id });
  }

  async findUserPhoneNumberOrEmail(
    getUserPhoneNumberOrEmail: GetUserPhoneNumberOrEmail,
  ): Promise<User> {
    const user = await this.userRepository.findOne({
      where: [
        { phone_number: getUserPhoneNumberOrEmail?.phone_number },
        { email: getUserPhoneNumberOrEmail?.email },
      ],
    });
    return user;
  }

  /**
   * Ultra-low latency user deletion for fast user offboarding.
   * Improved variable and function names for better readability and maintainability.
   */
  async permanentlyDeleteUser(req: Request): Promise<IStatusMessage> {
    const { user_id: userId } =
      await this.commonService.extractDataFromToken(req);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingUser = await queryRunner.manager.findOne(User, {
        where: { id: userId },
      });

      if (!existingUser) {
        throw new BadRequestException('User not found');
      }

      // Delete user profile picture from S3 if present
      if (existingUser.bucket_name && existingUser.profile_image_path) {
        const s3DeleteResult = await this.fileService.deleteFileFormS3(
          existingUser.bucket_name,
          existingUser.profile_image_path,
        );
        this.logger.log(s3DeleteResult);
      }

      // Delete all shared recordings where user is the recipient
      await queryRunner.manager.delete(SharedRecording, {
        shared_with_user_id: userId,
      });

      // Get all user's recordings to perform batch deletion based on their IDs
      const userOwnedRecordings = await queryRunner.manager.find(Recording, {
        where: { userId },
        select: ['id'],
      });
      const userRecordingIds = userOwnedRecordings.map((rec) => rec.id);

      if (userRecordingIds.length > 0) {
        // Delete all shared recordings and payments tied to these recordings in one go
        await Promise.all([
          queryRunner.manager.delete(SharedRecording, {
            recording_id: In(userRecordingIds),
          }),
          queryRunner.manager.delete(PaymentEntity, {
            recording_id: In(userRecordingIds),
          }),
        ]);
      }

      // Fast bulk delete: payments, notifications, uploads, FCM tokens, recordings, user account
      await Promise.all([
        queryRunner.manager.delete(PaymentEntity, { user_id: userId }),
        queryRunner.manager.delete(NotificationEntity, { user_id: userId }),
        queryRunner.manager.delete(MediaUploadEntity, { user_id: userId }),
        queryRunner.manager.delete(UserDevicesTokenEntity, { user_id: userId }),
        queryRunner.manager.delete(Recording, { userId }),
      ]);
      await queryRunner.manager.delete(User, { id: userId });

      await queryRunner.commitTransaction();

      return {
        message: 'User deleted successfully',
        status: HttpStatus.NO_CONTENT,
        type: 'success',
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
