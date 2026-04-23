import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class Msg91Service {
  private readonly logger = new Logger(Msg91Service.name);
  private readonly authKey = process.env.MSG91_AUTH_KEY;
  private readonly templateId = process.env.MSG91_OTP_TEMPLATE_ID;
  private readonly baseUrl = 'https://control.msg91.com/api/v5/otp';

  async sendOtp(mobile: string): Promise<void> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {},
        {
          params: {
            template_id: this.templateId,
            mobile,
            otp_expiry: 5,
          },
          headers: {
            authkey: this.authKey,
            'Content-Type': 'application/json',
          },
        },
      );

      if (response.data?.type === 'error') {
        this.logger.error(`MSG91 send OTP error: ${response.data.message}`);
        throw new BadRequestException(response.data.message);
      }

      this.logger.log(`OTP sent successfully to ${mobile}`);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Failed to send OTP: ${error.message}`);
      throw new BadRequestException('Failed to send OTP');
    }
  }

  async verifyOtp(mobile: string, otp: string): Promise<void> {
    try {
      const response = await axios.get(`${this.baseUrl}/verify`, {
        params: { otp, mobile },
        headers: {
          authkey: this.authKey,
        },
      });

      if (response.data?.type === 'error') {
        this.logger.error(`MSG91 verify OTP error: ${response.data.message}`);
        throw new BadRequestException(response.data.message);
      }

      this.logger.log(`OTP verified successfully for ${mobile}`);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Failed to verify OTP: ${error.message}`);
      throw new BadRequestException('Failed to verify OTP');
    }
  }
}
