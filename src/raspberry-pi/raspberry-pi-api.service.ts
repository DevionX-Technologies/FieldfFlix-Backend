import {
  Injectable,
  Logger,
  BadGatewayException,
  HttpStatus,
} from '@nestjs/common';
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

  private readonly liveApiKey =
    process.env.PI_LIVE_API_KEY ||
    process.env.PI_API_KEY ||
    process.env.RASPBERRY_PI_API_KEY ||
    '9d6bdf976525e1641b6162ebd6c5d13ff9ee13345e7d6cfcd702b18293ebadfd';

  private readonly evmsApiKey =
    process.env.PI_EVMS_API_KEY ||
    process.env.EVMS_API_KEY ||
    'b0967580ef4fe425b2336c25b0a9d19d06a9f3800a422ecd5785ddfd261172a6';

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
      `Triggering extraction on Pi (${raspberryPiBaseUrl}) for Recording ${payload.recordingId} (Channel ${payload.channel})`,
    );
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${raspberryPiBaseUrl}/extract-session`,
          payload,
          {
            headers: {
              'X-API-KEY': this.evmsApiKey,
              'Content-Type': 'application/json',
            },
            timeout: 180000, // 3 minutes timeout for extraction and upload initiation
          },
        ),
      );
      return response.data as ExtractSessionResponse;
    } catch (error: any) {
      const errMsg =
        error.response?.data?.message || error.message || 'Network error';
      this.logger.error(
        `Error extracting session on Pi (${raspberryPiBaseUrl}): ${errMsg}`,
      );
      throw new BadGatewayException(
        `Failed to communicate with Raspberry Pi at ${raspberryPiBaseUrl}: ${errMsg}`,
      );
    }
  }

  async getLiveStreamStatus(
    raspberryPiBaseUrl: string,
  ): Promise<{ publishing: boolean; streams: any[] }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${raspberryPiBaseUrl}/live-stream-status`, {
          headers: {
            'X-API-KEY': this.liveApiKey,
          },
          timeout: 8000,
        }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.warn(
        `Failed to fetch live stream status from ${raspberryPiBaseUrl}: ${error.message}`,
      );
      return { publishing: false, streams: [] };
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
              'X-API-KEY': this.liveApiKey,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        ),
      );
      return response.data;
    } catch (error: any) {
      const errMsg =
        error.response?.data?.message || error.message || 'Device unresponsive';
      this.logger.error(
        `Error starting live stream on Pi (${raspberryPiBaseUrl}): ${errMsg}`,
      );
      throw new BadGatewayException({
        statusCode: HttpStatus.BAD_GATEWAY,
        error: 'Edge Device Unresponsive',
        message: `Raspberry Pi bridge at ${raspberryPiBaseUrl} is offline or unreachable (${errMsg}). Verify that the court device is powered on and Tailscale tunnel is active.`,
        piUrl: raspberryPiBaseUrl,
        channel: payload.channel,
      });
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
              'X-API-KEY': this.liveApiKey,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        ),
      );
      return response.data;
    } catch (error: any) {
      const errMsg =
        error.response?.data?.message || error.message || 'Device unresponsive';
      this.logger.error(
        `Error stopping live stream on Pi (${raspberryPiBaseUrl}): ${errMsg}`,
      );
      throw new BadGatewayException({
        statusCode: HttpStatus.BAD_GATEWAY,
        error: 'Edge Device Unresponsive',
        message: `Raspberry Pi bridge at ${raspberryPiBaseUrl} did not respond: ${errMsg}`,
        piUrl: raspberryPiBaseUrl,
        channel: payload.channel,
      });
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
              'X-API-KEY': this.evmsApiKey,
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
              'X-API-KEY': this.evmsApiKey,
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
