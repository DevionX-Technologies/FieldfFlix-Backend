import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface StartRecordingResponse {
  recordingId: string;
}

interface StopRecordingResponse {
  s3Path: string;
}

@Injectable()
export class RaspberryPiApiService {
  private readonly logger = new Logger(RaspberryPiApiService.name);
  private readonly apiKey = process.env.RASPBERRY_PI_API_KEY;

  constructor(private readonly httpService: HttpService) {}

  async startRecording(
    raspberryPiBaseUrl: string,
  ): Promise<StartRecordingResponse> {
    this.logger.log(
      `Calling Raspberry Pi to start recording for raspberryPi: ${raspberryPiBaseUrl}`,
    );
    try {
      // This is a placeholder for the actual API call
      const response = await firstValueFrom(
        this.httpService.post(
          `${raspberryPiBaseUrl}/start`,
          {},
          {
            headers: {
              'X-API-KEY': this.apiKey,
            },
          },
        ),
      );
      // Assuming the Raspberry Pi API returns an object with a recordingId
      return response.data as StartRecordingResponse;
    } catch (error) {
      this.logger.error(
        `Error starting recording on Raspberry Pi: ${error.message}`,
      );
      throw new Error(`Failed to start recording: ${error.message}`);
    }
  }

  async stopRecording(
    raspberryPiBaseUrl: string,
    raspberryPiRecordingId: string,
  ): Promise<StopRecordingResponse> {
    this.logger.log(
      `Calling Raspberry Pi to stop recording with ID: ${raspberryPiRecordingId} and raspberryPiBaseUrl: ${raspberryPiBaseUrl}`,
    );
    try {
      // This is a placeholder for the actual API call
      const response = await firstValueFrom(
        this.httpService.post(
          `${raspberryPiBaseUrl}/stop`,
          {
            recordingId: raspberryPiRecordingId,
          },
          {
            headers: {
              'X-API-KEY': this.apiKey,
            },
          },
        ),
      );
      // Assuming the Raspberry Pi API returns an object with an s3Path
      return response.data as StopRecordingResponse;
    } catch (error) {
      this.logger.error(
        `Error stopping recording on Raspberry Pi: ${error.message}`,
      );
      throw new Error(
        `Failed to stop recording on Raspberry Pi: ${error.message}`,
      );
    }
  }
}
