import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface StartRecordingResponse {
  recordingId: string;
}

export interface StopRecordingResponse {
  s3Path: string;
}

export interface ExtractSessionPayload {
  recordingId: string;
  channel: number;
  startTime: string;
  endTime: string;
  uploadUrl: string;
  s3Key: string;
  callbackWebhookUrl?: string;
}

export interface ExtractSessionResponse {
  status: 'SUCCESS' | 'FAILED' | string;
  recordingId: string;
  s3Key?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  error?: string;
}

export interface StartLiveStreamPayload {
  channel: number;
  rtmpUrl: string;
}

export interface StopLiveStreamPayload {
  channel: number;
}

export interface PiHealthResponse {
  status: string;
  nvrIp?: string;
  nvrReachable?: boolean;
}

@Injectable()
export class RaspberryPiApiService {
  private readonly logger = new Logger(RaspberryPiApiService.name);
  private readonly apiKey = process.env.RASPBERRY_PI_API_KEY;

  constructor(private readonly httpService: HttpService) {}

  async checkHealth(raspberryPiBaseUrl: string): Promise<PiHealthResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${raspberryPiBaseUrl}/health`, {
          timeout: 5000,
        }),
      );
      return response.data as PiHealthResponse;
    } catch (error) {
      this.logger.warn(
        `Health check failed for ${raspberryPiBaseUrl}: ${error.message}`,
      );
      return { status: 'UNREACHABLE' };
    }
  }

  async extractSession(
    raspberryPiBaseUrl: string,
    payload: ExtractSessionPayload,
  ): Promise<ExtractSessionResponse> {
    this.logger.log(
      `Calling Pi to extract session ${payload.recordingId} (Channel ${payload.channel}, ${payload.startTime} to ${payload.endTime}) via ${raspberryPiBaseUrl}`,
    );
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${raspberryPiBaseUrl}/extract-session`,
          payload,
          {
            headers: {
              'X-API-KEY': this.apiKey,
              'Content-Type': 'application/json',
            },
            timeout: 120000, // 2 minutes timeout for extraction and upload initiation
          },
        ),
      );
      return response.data as ExtractSessionResponse;
    } catch (error) {
      this.logger.error(
        `Error extracting session on Pi (${raspberryPiBaseUrl}): ${error.message}`,
      );
      throw new Error(`Failed to extract session: ${error.message}`);
    }
  }

  async startLiveStream(
    raspberryPiBaseUrl: string,
    payload: StartLiveStreamPayload,
  ): Promise<{ status: string }> {
    this.logger.log(
      `Calling Pi to start live stream on Channel ${payload.channel} via ${raspberryPiBaseUrl}`,
    );
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${raspberryPiBaseUrl}/start-live-stream`,
          payload,
          {
            headers: {
              'X-API-KEY': this.apiKey,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Error starting live stream on Pi (${raspberryPiBaseUrl}): ${error.message}`,
      );
      throw new Error(`Failed to start live stream: ${error.message}`);
    }
  }

  async stopLiveStream(
    raspberryPiBaseUrl: string,
    payload: StopLiveStreamPayload,
  ): Promise<{ status: string }> {
    this.logger.log(
      `Calling Pi to stop live stream on Channel ${payload.channel} via ${raspberryPiBaseUrl}`,
    );
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${raspberryPiBaseUrl}/stop-live-stream`,
          payload,
          {
            headers: {
              'X-API-KEY': this.apiKey,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Error stopping live stream on Pi (${raspberryPiBaseUrl}): ${error.message}`,
      );
      throw new Error(`Failed to stop live stream: ${error.message}`);
    }
  }

  async startRecording(
    raspberryPiBaseUrl: string,
  ): Promise<StartRecordingResponse> {
    this.logger.log(
      `Calling Raspberry Pi to start recording for raspberryPi: ${raspberryPiBaseUrl}`,
    );
    try {
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
