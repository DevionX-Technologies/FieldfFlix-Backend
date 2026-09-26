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

/**
 * Last-resort static IP map for venues whose Tailscale Funnel DNS is
 * unreachable from the ECS VPC. Values are overridable via
 * PI_<VENUE>_GATEWAY_IP so venue networking can be re-pointed without a deploy.
 */
const PI_HOST_IP_FALLBACK: Record<string, string> = {
  'cpu.taild82368.ts.net': process.env.PI_BOTANICAL_GATEWAY_IP ?? '',
  'raspberrypi-court17-1.taild82368.ts.net':
    process.env.PI_COURT17_GATEWAY_IP ?? '',
  'raspberrypi-court11.taild82368.ts.net':
    process.env.PI_COURT11_GATEWAY_IP ?? '',
  'pickleflow-social.taild82368.ts.net':
    process.env.PI_PICKLEFLOW_GATEWAY_IP ?? '',
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

  /**
   * Device API keys are NEVER hardcoded. Resolution order:
   *   1. per-camera key passed by the caller (`camera.raspberryPiApiKey`)
   *   2. per-venue override env var (PI_LIVE_API_KEY_<VENUE> / PI_EVMS_API_KEY_<VENUE>)
   *   3. the shared PI_LIVE_API_KEY / PI_EVMS_API_KEY
   *
   * The previous per-venue literals were committed to git and must be treated
   * as compromised — rotate them on the devices and set the env vars below.
   */
  private readonly liveApiKey =
    process.env.PI_LIVE_API_KEY ?? process.env.PI_API_KEY ?? '';

  private readonly evmsApiKey =
    process.env.PI_EVMS_API_KEY ?? process.env.EVMS_API_KEY ?? '';

  /** Derives `court17-1` / `court11` / `botanical` / `pickleflow` from a base URL. */
  private venueSlug(raspberryPiBaseUrl: string): string {
    const host = (raspberryPiBaseUrl || '').toLowerCase();
    if (host.includes('pickleflow')) return 'pickleflow';
    if (host.includes('court17-1')) return 'court17';
    if (host.includes('court11')) return 'court11';
    if (host.includes('cpu.taild')) return 'botanical';
    return 'default';
  }

  private scopedKey(raspberryPiBaseUrl: string, kind: 'LIVE' | 'EVMS'): string {
    const slug = this.venueSlug(raspberryPiBaseUrl).toUpperCase();
    const scoped = process.env[`PI_${kind}_API_KEY_${slug}`];
    if (scoped?.trim()) return scoped.trim();
    return kind === 'LIVE' ? this.liveApiKey : this.evmsApiKey;
  }

  private getLiveApiKey(
    raspberryPiBaseUrl: string,
    customKey?: string,
  ): string {
    if (customKey?.trim()) return customKey.trim();
    return this.scopedKey(raspberryPiBaseUrl, 'LIVE');
  }

  private getEvmsApiKey(
    raspberryPiBaseUrl: string,
    customKey?: string,
  ): string {
    if (customKey?.trim()) return customKey.trim();
    return this.scopedKey(raspberryPiBaseUrl, 'EVMS');
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
   * Guards against dispatching to a device with no configured credential. An
   * empty `X-API-KEY` would otherwise produce a confusing 401 from the Pi.
   */
  private assertApiKey(
    apiKey: string,
    baseUrl: string,
    operation: string,
  ): void {
    if (apiKey?.trim()) return;
    throw new BadGatewayException(
      `No API key configured for ${operation} on ${baseUrl}. Set PI_EVMS_API_KEY / PI_LIVE_API_KEY, a PI_*_API_KEY_<VENUE> override, or the camera's own API key.`,
    );
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
    const recordingsTargetUrl = this.getRecordingsBaseUrl(raspberryPiBaseUrl);
    const liveTargetUrl = this.getLiveBaseUrl(raspberryPiBaseUrl);

    // Primary: EVMS NVR Extraction service runs on Port 443
    const primaryUrl = recordingsTargetUrl || liveTargetUrl;
    const primaryApiKey = this.getEvmsApiKey(raspberryPiBaseUrl, customApiKey);
    this.assertApiKey(primaryApiKey, primaryUrl, 'extract-session');

    // Fallback: Live streaming daemon on Port 8443
    const fallbackUrl =
      primaryUrl === recordingsTargetUrl ? liveTargetUrl : recordingsTargetUrl;
    const fallbackApiKey = this.getLiveApiKey(raspberryPiBaseUrl, customApiKey);

    this.logger.log(
      `Triggering extraction on Pi Gateway (${primaryUrl}) for Recording ${payload.recordingId} (Channel ${payload.channel})`,
    );

    try {
      const response = await this.piPost<any>(
        `${primaryUrl}/extract-session`,
        payload,
        {
          'X-API-KEY': primaryApiKey,
          'Content-Type': 'application/json',
        },
        1800000, // 30 minutes
      );
      return (response?.detail || response) as ExtractSessionResponse;
    } catch (primaryErr: any) {
      if (fallbackUrl && fallbackUrl !== primaryUrl) {
        this.logger.warn(
          `Primary extraction on ${primaryUrl} failed (${primaryErr.message}). Retrying fallback on ${fallbackUrl}...`,
        );
        try {
          const fallbackRes = await this.piPost<any>(
            `${fallbackUrl}/extract-session`,
            payload,
            {
              'X-API-KEY': fallbackApiKey,
              'Content-Type': 'application/json',
            },
            1800000, // 30 minutes
          );
          return (fallbackRes?.detail || fallbackRes) as ExtractSessionResponse;
        } catch (fallbackErr: any) {
          const errMsg =
            fallbackErr.response?.data?.message ||
            fallbackErr.response?.data?.error ||
            fallbackErr.message ||
            'Network error';
          this.logger.error(
            `Error extracting session on Pi fallback (${fallbackUrl}): ${errMsg}`,
          );
          throw new BadGatewayException(
            `Failed to communicate with Raspberry Pi at ${fallbackUrl}: ${errMsg}`,
          );
        }
      }

      const errMsg =
        primaryErr.response?.data?.message ||
        primaryErr.response?.data?.error ||
        primaryErr.message ||
        'Network error';
      this.logger.error(
        `Error extracting session on Pi (${primaryUrl}): ${errMsg}`,
      );
      throw new BadGatewayException(
        `Failed to communicate with Raspberry Pi at ${primaryUrl}: ${errMsg}`,
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
    this.assertApiKey(
      this.getLiveApiKey(raspberryPiBaseUrl, customApiKey),
      targetUrl,
      'start-live-stream',
    );

    try {
      return await this.piPost<any>(
        `${targetUrl}/start-live-stream`,
        payload,
        {
          'X-API-KEY': this.getLiveApiKey(raspberryPiBaseUrl, customApiKey),
          'Content-Type': 'application/json',
        },
        35000,
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
    this.assertApiKey(
      this.getLiveApiKey(raspberryPiBaseUrl, customApiKey),
      targetUrl,
      'stop-live-stream',
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
