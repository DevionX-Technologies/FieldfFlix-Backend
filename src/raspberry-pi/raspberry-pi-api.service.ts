import {
  Injectable,
  Logger,
  BadGatewayException,
  HttpStatus,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as dns from 'node:dns';
import { resolve4 } from 'node:dns/promises';
import * as https from 'node:https';
import type { AxiosRequestConfig } from 'axios';

/** Last-resort when VPC + public DNS both fail (Tailscale funnel IPs can change). */
const PI_HOST_IP_FALLBACK: Record<string, string> = {
  'cpu.taild82368.ts.net':
    process.env.PI_BOTANICAL_GATEWAY_IP || '103.84.155.153',
  'raspberrypi-court17-1.taild82368.ts.net':
    process.env.PI_COURT17_GATEWAY_IP || '103.84.155.153',
  'raspberrypi-court11.taild82368.ts.net':
    process.env.PI_COURT11_GATEWAY_IP || '103.84.155.217',
};

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

  private getLiveApiKey(
    raspberryPiBaseUrl: string,
    customKey?: string,
  ): string {
    if (customKey) return customKey;

    if (
      raspberryPiBaseUrl?.includes('court17-1') ||
      raspberryPiBaseUrl?.includes('cpu.taild82368.ts.net')
    ) {
      return '8574b1b253c577210132a9dc0f084b69c4acfa4e82715b889cc5573d512ab6f2';
    }
    return this.liveApiKey;
  }

  private getEvmsApiKey(
    raspberryPiBaseUrl: string,
    customKey?: string,
  ): string {
    if (customKey) return customKey;

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
   * ECS/VPC DNS often fails for Tailscale Funnel (*.ts.net).
   * Use dns.resolve4 (respects setServers) — NOT dns.lookup (libc getaddrinfo only).
   */
  private async resolvePiHostname(hostname: string): Promise<string | null> {
    if (!hostname || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return null;
    }

    const tryResolve4 = async (): Promise<string> => {
      const addresses = await resolve4(hostname);
      if (!addresses?.length) {
        throw new Error(`No A records for ${hostname}`);
      }
      return addresses[0];
    };

    try {
      return await tryResolve4();
    } catch (primaryErr) {
      const prior = dns.getServers();
      try {
        dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
        const address = await tryResolve4();
        this.logger.warn(
          `Resolved Pi host ${hostname} via public DNS -> ${address}`,
        );
        return address;
      } catch (fallbackErr) {
        const staticIp = PI_HOST_IP_FALLBACK[hostname.toLowerCase()];
        if (staticIp) {
          this.logger.warn(
            `Using static Pi IP fallback for ${hostname} -> ${staticIp} (DNS: ${(primaryErr as Error).message})`,
          );
          return staticIp;
        }
        this.logger.warn(
          `DNS lookup failed for ${hostname}: ${(primaryErr as Error).message}; public: ${(fallbackErr as Error).message}`,
        );
        return null;
      } finally {
        dns.setServers(prior);
      }
    }
  }

  private async buildPiRequest(
    fullUrl: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<{ url: string; config: AxiosRequestConfig }> {
    const parsed = new URL(fullUrl);
    const originalHostname = parsed.hostname;
    const resolvedIp = await this.resolvePiHostname(originalHostname);
    let url = fullUrl;
    let httpsAgent: https.Agent | undefined;

    if (resolvedIp && resolvedIp !== originalHostname) {
      parsed.hostname = resolvedIp;
      url = parsed.toString();
      httpsAgent = new https.Agent({ servername: originalHostname });
    }

    return {
      url,
      config: {
        headers,
        timeout: timeoutMs,
        ...(httpsAgent ? { httpsAgent } : {}),
      },
    };
  }

  private async piGet<T>(
    fullUrl: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<T> {
    const { url, config } = await this.buildPiRequest(
      fullUrl,
      headers,
      timeoutMs,
    );
    const response = await firstValueFrom(this.httpService.get(url, config));
    return response.data as T;
  }

  private async piPost<T>(
    fullUrl: string,
    body: unknown,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<T> {
    const { url, config } = await this.buildPiRequest(
      fullUrl,
      headers,
      timeoutMs,
    );
    const response = await firstValueFrom(
      this.httpService.post(url, body, config),
    );
    return response.data as T;
  }

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
      return await this.piGet<PiHealthResponse>(
        `${targetUrl}/health`,
        {},
        8000,
      );
    } catch (error) {
      this.logger.warn(
        `Health check failed for ${targetUrl}: ${(error as Error).message}`,
      );
      return { status: 'UNREACHABLE' };
    }
  }

  async extractSession(
    raspberryPiBaseUrl: string,
    payload: ExtractSessionPayload,
    customApiKey?: string,
  ): Promise<ExtractSessionResponse> {
    const targetUrl = this.getRecordingsBaseUrl(raspberryPiBaseUrl);
    this.logger.log(
      `Triggering extraction on Pi Recordings Gateway (${targetUrl}) for Recording ${payload.recordingId} (Channel ${payload.channel})`,
    );
    try {
      return await this.piPost<ExtractSessionResponse>(
        `${targetUrl}/extract-session`,
        payload,
        {
          'X-API-KEY': this.getEvmsApiKey(raspberryPiBaseUrl, customApiKey),
          'Content-Type': 'application/json',
        },
        300000,
      );
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
    customApiKey?: string,
  ): Promise<{ publishing: boolean; streams: any[] }> {
    const targetUrl = this.getLiveBaseUrl(raspberryPiBaseUrl);
    try {
      return await this.piGet<{ publishing: boolean; streams: any[] }>(
        `${targetUrl}/live-stream-status`,
        {
          'X-API-KEY': this.getLiveApiKey(raspberryPiBaseUrl, customApiKey),
        },
        8000,
      );
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
    customApiKey?: string,
  ): Promise<any> {
    const targetUrl = this.getLiveBaseUrl(raspberryPiBaseUrl);
    this.logger.log(
      `Triggering Live Stream on Pi Gateway (${targetUrl}) for channel ${payload.channel} -> ${payload.rtmpUrl}`,
    );

    try {
      return await this.piPost<any>(
        `${targetUrl}/start-live-stream`,
        payload,
        {
          'X-API-KEY': this.getLiveApiKey(raspberryPiBaseUrl, customApiKey),
          'Content-Type': 'application/json',
        },
        15000,
      );
    } catch (error: any) {
      if (error.response?.status === 409) {
        this.logger.log(
          `Channel ${payload.channel} is already streaming on ${targetUrl}. Returning success.`,
        );
        return { status: 'LIVE_STREAM_STARTED' };
      }

      const detail = String(
        error.response?.data?.detail || error.response?.data?.message || '',
      ).toLowerCase();
      if (detail.includes('already live')) {
        this.logger.log(
          `Channel ${payload.channel} already live on ${targetUrl}. Returning success.`,
        );
        return { status: 'LIVE_STREAM_STARTED' };
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

  async stopLiveStream(
    raspberryPiBaseUrl: string,
    payload: StopLiveStreamPayload,
    customApiKey?: string,
  ): Promise<{ status: string; warning?: string }> {
    const targetUrl = this.getLiveBaseUrl(raspberryPiBaseUrl);
    this.logger.log(
      `Calling Pi to stop live stream on Channel ${payload.channel} via ${targetUrl}`,
    );
    try {
      return await this.piPost<{ status: string }>(
        `${targetUrl}/stop-live-stream`,
        payload,
        {
          'X-API-KEY': this.getLiveApiKey(raspberryPiBaseUrl, customApiKey),
          'Content-Type': 'application/json',
        },
        8000,
      );
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

      const errCode = String(error.code ?? '');
      const isUnreachable =
        !error.response ||
        errCode === 'ECONNABORTED' ||
        errCode === 'ETIMEDOUT' ||
        errCode === 'ECONNREFUSED' ||
        errCode === 'ECONNRESET' ||
        errCode === 'ENOTFOUND' ||
        errCode === 'EHOSTUNREACH';

      if (isUnreachable) {
        this.logger.warn(
          `Stop live stream: Pi unreachable at ${targetUrl}, assuming stopped (${errMsg})`,
        );
        return {
          status: 'STOPPED_ASSUMED',
          warning: `Pi bridge did not respond (${errMsg}). Stream marked stopped in admin.`,
        };
      }

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
