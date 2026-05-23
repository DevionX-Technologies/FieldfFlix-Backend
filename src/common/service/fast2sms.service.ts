import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/** Fast2SMS DLT bulkV2: https://www.fast2sms.com/dev/bulkV2 */
@Injectable()
export class Fast2SmsService {
  private readonly logger = new Logger(Fast2SmsService.name);
  private readonly baseUrl = 'https://www.fast2sms.com/dev/bulkV2';

  private get authorization() {
    return process.env.FAST2SMS_AUTHORIZATION;
  }
  private get senderId() {
    return process.env.FAST2SMS_SENDER_ID;
  }
  /** DLT template / message id (the `message=` query param). */
  private get dltMessageId() {
    return process.env.FAST2SMS_DLT_MESSAGE_ID;
  }

  /**
   * `mobile` digits (e.g. 9198…). `otp` is substituted into the DLT template via `variables_values`.
   */
  async sendDltOtp(mobile: string, otp: string): Promise<void> {
    if (
      !this.authorization?.trim() ||
      !this.senderId?.trim() ||
      !this.dltMessageId?.trim()
    ) {
      this.logger.error('Fast2SMS is not configured (missing env)');
      throw new BadRequestException('SMS service is not configured');
    }

    const d = mobile.replace(/\D/g, '');
    const numbers = d.length === 10 ? d : d.length >= 10 ? d.slice(-10) : d;
    if (numbers.length < 10) {
      throw new BadRequestException('Invalid phone number for SMS');
    }

    try {
      const { data } = await axios.get<{
        return?: boolean;
        message?: string | string[];
      }>(this.baseUrl, {
        params: {
          authorization: this.authorization.trim(),
          route: 'dlt',
          sender_id: this.senderId.trim(),
          message: this.dltMessageId.trim(),
          variables_values: otp,
          numbers,
          flash: '0',
        },
        timeout: 20000,
      });

      if (data?.return === true) {
        this.logger.log(`Fast2SMS DLT sent to …${numbers.slice(-4)}`);
        return;
      }

      const msg = Array.isArray(data?.message)
        ? data.message.join(', ')
        : (data?.message ?? 'SMS request rejected');
      this.logger.error(`Fast2SMS error: ${msg}`);
      throw new BadRequestException(msg);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const err = error as { message?: string; response?: { data?: unknown } };
      this.logger.error(
        `Fast2SMS request failed: ${err.message} ${JSON.stringify(err.response?.data)}`,
      );
      throw new BadRequestException('Failed to send verification SMS');
    }
  }
}
