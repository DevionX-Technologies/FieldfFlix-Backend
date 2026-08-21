import * as https from 'https';
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

  private getLiveApiKey(raspberryPiBaseUrl: string): string {
    if (
      raspberryPiBaseUrl?.includes('court17-1') ||
      raspberryPiBaseUrl?.includes('cpu.taild82368.ts.net')
    ) {
      return '8574b1b253c577210132a9dc0f084b69c4acfa4e82715b889cc5573d512ab6f2';
    }
    return this.liveApiKey;
  }

  private getEvmsApiKey(raspberryPiBaseUrl: string): string {
    if (
      raspberryPiBaseUrl?.includes('court17-1') ||
      raspberryPiBaseUrl?.includes('cpu.taild82368.ts.net')
    ) {
      return '7e323f6f3b08ddd9b5aa12a7fa2f3c575ee7021f7435a29b9e00f3c91d683f46';
    }
    return this.evmsApiKey;
  }

  constructor(private readonly httpService: HttpService) {}

  /**
   * Live streaming runs on Port 8443 on the Tailscale Funnel.
   */
  private getLiveBaseUrl(baseUrl: string): string {
    const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
    if (!trimmed) return trimmed;
    if (trimmed.includes('.ts.net') && !trimmed.includes(':8443')) {
      return `${trimmed}:8443`;
    }
    return trimmed;
  }

  /**
   * Recordings / EVMS NVR extraction runs on standard HTTPS (Port 443).
   */
  private getRecordingsBaseUrl(baseUrl: string): string {
    const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
    if (!trimmed) return trimmed;
    return trimmed.replace(/:8443$/, '').replace(/:8090$/, '');
  }

  async checkHealth(raspberryPiBaseUrl: string): Promise<PiHealthResponse> {
    const targetUrl = this.getLiveBaseUrl(raspberryPiBaseUrl);
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${targetUrl}/health`, {
          timeout: 5000,
        }),
      );
      return response.data as PiHealthResponse;
    } catch (error) {
      this.logger.warn(
        `Health check failed for ${targetUrl}: ${error.message}`,
      );
      return { status: 'UNREACHABLE' };
    }
  }

  async extractSession(
    raspberryPiBaseUrl: string,
    payload: ExtractSessionPayload,
  ): Promise<ExtractSessionResponse> {
    const targetUrl = this.getRecordingsBaseUrl(raspberryPiBaseUrl);
    this.logger.log(
      `Triggering extraction on Pi Recordings Gateway (${targetUrl}) for Recording ${payload.recordingId} (Channel ${payload.channel})`,
    );
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${targetUrl}/extract-session`, payload, {
          headers: {
            'X-API-KEY': this.getEvmsApiKey(raspberryPiBaseUrl),
            'Content-Type': 'application/json',
          },
          timeout: 300000, // 5 minutes timeout for slicing and uploading to S3
        }),
      );
      return response.data as ExtractSessionResponse;
    } catch (error: any) {
      const errMsg =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        'Network error';
      this.logger.error(
        `Error extracting session on Pi (${targetUrl}): ${errMsg}`,
      );
      throw new BadGatewayException(
        `Failed to communicate with Raspberry Pi at ${targetUrl}: ${errMsg}`,
      );
    }
  }

  async getLiveStreamStatus(
    raspberryPiBaseUrl: string,
  ): Promise<{ publishing: boolean; streams: any[] }> {
    const targetUrl = this.getLiveBaseUrl(raspberryPiBaseUrl);
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${targetUrl}/live-stream-status`, {
          headers: {
            'X-API-KEY': this.getLiveApiKey(raspberryPiBaseUrl),
          },
          timeout: 8000,
        }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.warn(
        `Failed to fetch live stream status from ${targetUrl}: ${error.message}`,
      );
      return { publishing: false, streams: [] };
    }
  }

  async startLiveStream(
    raspberryPiBaseUrl: string,
    payload: StartLiveStreamPayload,
  ): Promise<{ status: string }> {
    const targetUrl = this.getLiveBaseUrl(raspberryPiBaseUrl);
    this.logger.log(
      `Calling Pi to start live stream on Channel ${payload.channel} via ${targetUrl}`,
    );

    let retries = 2;
    while (retries >= 0) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(`${targetUrl}/start-live-stream`, payload, {
            headers: {
              'X-API-KEY': this.getLiveApiKey(raspberryPiBaseUrl),
              'Content-Type': 'application/json',
            },
            timeout: 10000,
            httpsAgent: new https.Agent({
              keepAlive: true,
              keepAliveMsecs: 15000,
            }),
          }),
        );
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 409) {
          this.logger.log(
            `Channel ${payload.channel} is already streaming on ${targetUrl}. Returning success.`,
          );
          return { status: 'LIVE_STREAM_STARTED' };
        }

        if (error.code === 'ENOTFOUND' && retries > 0) {
          this.logger.warn(
            `DNS resolution failed (ENOTFOUND) for ${targetUrl}. Retrying... (${retries} retries left)`,
          );
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 800)); // wait 800ms before retrying
          continue;
        }

        const errMsg =
          error.response?.data?.detail ||
          error.response?.data?.message ||
          error.message ||
          'Device unresponsive';
        this.logger.error(
          `Error starting live stream on Pi (${targetUrl}): ${errMsg}`,
        );
        throw new BadGatewayException({
          statusCode: HttpStatus.BAD_GATEWAY,
          error: 'Edge Device Unresponsive',
          message: `Raspberry Pi bridge at ${targetUrl} is offline or unreachable (${errMsg}). Verify that the court device is powered on and Tailscale tunnel is active.`,
          piUrl: targetUrl,
          channel: payload.channel,
        });
      }
    }

    return { status: 'ERROR' };
  }

  async stopLiveStream(
    raspberryPiBaseUrl: string,
    payload: StopLiveStreamPayload,
  ): Promise<{ status: string }> {
    const targetUrl = this.getLiveBaseUrl(raspberryPiBaseUrl);
    this.logger.log(
      `Calling Pi to stop live stream on Channel ${payload.channel} via ${targetUrl}`,
    );
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${targetUrl}/stop-live-stream`, payload, {
          headers: {
            'X-API-KEY': this.getLiveApiKey(raspberryPiBaseUrl),
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }),
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.logger.log(
          `Live stream on Channel ${payload.channel} is already stopped (404 Not Found).`,
        );
        return { status: 'ALREADY_STOPPED' };
      }

      const errMsg =
        error.response?.data?.detail ||
        error.response?.data?.message ||
        error.message ||
        'Device unresponsive';

      this.logger.error(
        `Error stopping live stream on Pi (${targetUrl}): ${errMsg}`,
      );
      throw new BadGatewayException({
        statusCode: HttpStatus.BAD_GATEWAY,
        error: 'Edge Device Unresponsive',
        message: `Raspberry Pi bridge at ${targetUrl} did not respond: ${errMsg}`,
        piUrl: targetUrl,
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
              'X-API-KEY': this.getEvmsApiKey(raspberryPiBaseUrl),
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
              'X-API-KEY': this.getEvmsApiKey(raspberryPiBaseUrl),
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
