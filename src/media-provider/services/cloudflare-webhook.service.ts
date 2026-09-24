import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

export interface NormalizedMediaEvent {
  provider: 'cloudflare';
  eventId: string;
  eventType:
    | 'live.connected'
    | 'live.disconnected'
    | 'live.reconnecting'
    | 'video.ready'
    | 'video.failed'
    | 'video.upload_complete'
    | 'unknown';
  rawEventType: string;
  assetId: string;
  playbackId?: string;
  playbackUrl?: string;
  durationSeconds?: number;
  status: string;
  timestamp: Date;
  passthrough?: string;
  rawPayload: any;
}

@Injectable()
export class CloudflareWebhookService {
  private readonly logger = new Logger(CloudflareWebhookService.name);

  // In-memory deduplication set for environments without active DB connection during unit tests
  private readonly inMemoryDeduplication = new Set<string>();

  constructor(
    @Optional()
    @InjectDataSource()
    private readonly dataSource?: DataSource,
  ) {}

  /**
   * Verifies the Cloudflare Stream Webhook-Signature header.
   * Header format: `time=1629891234,sig1=c584400e...`
   */
  verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    customSecret?: string,
  ): boolean {
    const secret = customSecret || process.env.CLOUDFLARE_WEBHOOK_SECRET;

    if (!secret) {
      this.logger.warn(
        'CLOUDFLARE_WEBHOOK_SECRET is not configured. Webhook signature check bypassed (dev only).',
      );
      return true;
    }

    if (!signatureHeader || !rawBody) {
      throw new BadRequestException('Missing webhook signature or raw payload');
    }

    const elements = signatureHeader.split(',');
    let timestamp: number | null = null;
    let signatureHex: string | null = null;

    for (const elem of elements) {
      const [key, value] = elem.trim().split('=');
      if (key === 'time') {
        timestamp = parseInt(value, 10);
      } else if (key === 'sig1') {
        signatureHex = value;
      }
    }

    if (!timestamp || !signatureHex) {
      throw new BadRequestException('Malformed Webhook-Signature header');
    }

    // 5-minute replay attack window
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > 300) {
      throw new BadRequestException(
        'Webhook signature timestamp expired or invalid',
      );
    }

    const payloadToSign = `${timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadToSign)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(signatureHex, 'utf8');

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      throw new BadRequestException('Webhook signature verification failed');
    }

    return true;
  }

  /**
   * Normalizes Cloudflare Stream event payload into standard NormalizedMediaEvent.
   */
  normalizeEvent(payload: any, eventIdHeader?: string): NormalizedMediaEvent {
    const eventId =
      eventIdHeader ||
      payload.event_id ||
      payload.uid ||
      payload.id ||
      `cf_evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const rawType = String(
      payload.type || payload.event || payload.status?.state || 'unknown',
    ).toLowerCase();

    const assetId =
      payload.uid || payload.data?.uid || payload.data?.id || payload.id || '';

    let eventType: NormalizedMediaEvent['eventType'] = 'unknown';

    if (rawType.includes('live_input.connected') || rawType === 'connected') {
      eventType = 'live.connected';
    } else if (
      rawType.includes('live_input.reconnecting') ||
      rawType === 'reconnecting'
    ) {
      eventType = 'live.reconnecting';
    } else if (
      rawType.includes('live_input.disconnected') ||
      rawType === 'disconnected'
    ) {
      eventType = 'live.disconnected';
    } else if (rawType === 'ready' || rawType.includes('video.ready')) {
      eventType = 'video.ready';
    } else if (
      rawType === 'error' ||
      rawType.includes('video.errored') ||
      rawType.includes('video.failed')
    ) {
      eventType = 'video.failed';
    } else if (rawType.includes('upload_complete')) {
      eventType = 'video.upload_complete';
    }

    const playbackUrl =
      payload.playback?.hls ||
      (assetId
        ? `https://videodelivery.net/${assetId}/manifest/video.m3u8`
        : undefined);

    return {
      provider: 'cloudflare',
      eventId,
      eventType,
      rawEventType: rawType,
      assetId,
      playbackId: assetId,
      playbackUrl,
      durationSeconds: payload.duration,
      status: payload.status?.state || rawType,
      timestamp: payload.created ? new Date(payload.created) : new Date(),
      passthrough: payload.meta?.passthrough || payload.meta?.recordingId,
      rawPayload: payload,
    };
  }

  /**
   * Ensures idempotency: records event ID in `webhook_events` table (or in-memory cache).
   * Returns `{ isDuplicate: true }` if this event was already processed.
   */
  async recordEventIdempotent(
    eventId: string,
    eventType: string,
    assetId?: string,
  ): Promise<{ isDuplicate: boolean }> {
    const prefixedEventId = `cf_${eventId}`;

    if (this.inMemoryDeduplication.has(prefixedEventId)) {
      this.logger.warn(
        `Duplicate Cloudflare webhook received (in-memory): ${eventId}`,
      );
      return { isDuplicate: true };
    }

    if (this.dataSource && this.dataSource.isInitialized) {
      try {
        const existing = await this.dataSource.query(
          `SELECT id FROM webhook_events WHERE mux_event_id = $1 LIMIT 1`,
          [prefixedEventId],
        );

        if (existing && existing.length > 0) {
          this.logger.warn(
            `Duplicate Cloudflare webhook received (DB): ${eventId}`,
          );
          return { isDuplicate: true };
        }

        await this.dataSource.query(
          `INSERT INTO webhook_events (mux_event_id, event_type, asset_id, processed_at) VALUES ($1, $2, $3, NOW())`,
          [prefixedEventId, eventType, assetId || null],
        );
      } catch (err: any) {
        // Unique constraint violation indicates concurrent duplicate delivery
        if (err.code === '23505') {
          return { isDuplicate: true };
        }
        this.logger.warn(
          `Failed to record webhook event in database: ${err.message}. Relying on in-memory deduplication.`,
        );
      }
    }

    this.inMemoryDeduplication.add(prefixedEventId);
    return { isDuplicate: false };
  }
}
