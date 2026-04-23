import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as admin from 'firebase-admin';
import { FIREBASE_ADMIN } from 'src/constant/providers.constant';
import { IFmcNotification } from 'src/interface/interface';
import { UserDevicesTokenEntity } from 'src/user/entities/user-devices-token.entity';
import { Repository } from 'typeorm';
@Injectable()
export class FireBaseNotificationService {
  private readonly logger = new Logger(FireBaseNotificationService.name);
  constructor(
    @Inject(FIREBASE_ADMIN) private readonly firebaseAdmin: admin.app.App,
    @InjectRepository(UserDevicesTokenEntity)
    private readonly userDevicesTokenEntity: Repository<UserDevicesTokenEntity>,
  ) {}

  async sendNotification(
    messages: IFmcNotification,
    user_id: string,
  ): Promise<any> {
    // Send notifications concurrently
    try {
      const response = await this.firebaseAdmin.messaging().send(messages);
      this.logger.log(`Message sent successfully: ${response}`);
      return response;
    } catch (error) {
      this.logger.error('Error sending notification:', error);
      await this.handleIndividualError(error, messages.token, user_id);
    }
  }

  /**
   * Handles individual message sending errors.
   */
  private async handleIndividualError(
    error: any,
    deviceId: string,
    user_id: string,
  ): Promise<void> {
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      await this.removeDeviceId(deviceId, user_id);
      this.logger.error(
        `Unhandled FCM error: ${error.code} /n ${error.errorInfo.message}`,
      );
    } else {
      this.logger.error(
        `Unhandled FCM error: ${error.code} /n ${error.errorInfo.message}`,
      );
    }
  }

  async removeDeviceId(failedToken: string, user_id: string): Promise<any> {
    const updatedDevicesID = await this.userDevicesTokenEntity.delete({
      devices_id: failedToken,
      user_id: user_id,
    });
    return updatedDevicesID;
  }
}
