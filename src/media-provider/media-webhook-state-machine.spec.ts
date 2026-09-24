import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  LiveSessionStateMachine,
  MediaAssetStateMachine,
  MediaStateTransitionError,
} from './state-machines/media-state-machine';
import { CloudflareWebhookService } from './services/cloudflare-webhook.service';
import { CloudflareWebhookController } from './controllers/cloudflare-webhook.controller';

describe('Media State Machines and Webhook Processing', () => {
  describe('LiveSessionStateMachine', () => {
    it('allows valid transitions throughout the live session lifecycle', () => {
      expect(
        LiveSessionStateMachine.canTransition('CREATED', 'PROVISIONING'),
      ).toBe(true);
      expect(
        LiveSessionStateMachine.canTransition('PROVISIONING', 'READY'),
      ).toBe(true);
      expect(LiveSessionStateMachine.canTransition('READY', 'LIVE')).toBe(true);
      expect(
        LiveSessionStateMachine.canTransition('LIVE', 'RECONNECTING'),
      ).toBe(true);
      expect(
        LiveSessionStateMachine.canTransition('RECONNECTING', 'LIVE'),
      ).toBe(true);
      expect(LiveSessionStateMachine.canTransition('LIVE', 'STOPPING')).toBe(
        true,
      );
      expect(LiveSessionStateMachine.canTransition('STOPPING', 'ENDED')).toBe(
        true,
      );
    });

    it('supports idempotent same-state transitions', () => {
      expect(LiveSessionStateMachine.canTransition('LIVE', 'LIVE')).toBe(true);
      expect(LiveSessionStateMachine.canTransition('READY', 'READY')).toBe(
        true,
      );
      expect(() =>
        LiveSessionStateMachine.assertValidTransition('LIVE', 'LIVE'),
      ).not.toThrow();
    });

    it('throws MediaStateTransitionError on disallowed transitions', () => {
      expect(() =>
        LiveSessionStateMachine.assertValidTransition('ENDED', 'PROVISIONING'),
      ).toThrow(MediaStateTransitionError);

      expect(() =>
        LiveSessionStateMachine.assertValidTransition('CREATED', 'LIVE'),
      ).toThrow(MediaStateTransitionError);
    });

    it('correctly handles out-of-order event detection', () => {
      // Stream is already LIVE; an older READY or CONNECTING event should be ignored
      expect(
        LiveSessionStateMachine.shouldIgnoreOutOfOrder('LIVE', 'READY'),
      ).toBe(true);
      expect(
        LiveSessionStateMachine.shouldIgnoreOutOfOrder('LIVE', 'CONNECTING'),
      ).toBe(true);

      // Stream is READY; incoming LIVE should NOT be ignored
      expect(
        LiveSessionStateMachine.shouldIgnoreOutOfOrder('READY', 'LIVE'),
      ).toBe(false);

      // Stream is in terminal state ENDED; any older or new non-terminal events should be ignored
      expect(
        LiveSessionStateMachine.shouldIgnoreOutOfOrder('ENDED', 'LIVE'),
      ).toBe(true);
      expect(
        LiveSessionStateMachine.shouldIgnoreOutOfOrder('ENDED', 'READY'),
      ).toBe(true);
    });
  });

  describe('MediaAssetStateMachine', () => {
    it('allows valid lifecycle transitions from creation to ready and published', () => {
      expect(
        MediaAssetStateMachine.canTransition('CREATED', 'UPLOAD_PENDING'),
      ).toBe(true);
      expect(
        MediaAssetStateMachine.canTransition('UPLOAD_PENDING', 'UPLOADING'),
      ).toBe(true);
      expect(
        MediaAssetStateMachine.canTransition('UPLOADING', 'UPLOADED'),
      ).toBe(true);
      expect(
        MediaAssetStateMachine.canTransition('UPLOADED', 'PROCESSING'),
      ).toBe(true);
      expect(MediaAssetStateMachine.canTransition('PROCESSING', 'READY')).toBe(
        true,
      );
      expect(MediaAssetStateMachine.canTransition('READY', 'PUBLISHED')).toBe(
        true,
      );
      expect(
        MediaAssetStateMachine.canTransition('PUBLISHED', 'ARCHIVED'),
      ).toBe(true);
    });

    it('allows retries from FAILED state', () => {
      expect(
        MediaAssetStateMachine.canTransition('FAILED', 'UPLOAD_PENDING'),
      ).toBe(true);
      expect(MediaAssetStateMachine.canTransition('FAILED', 'PROCESSING')).toBe(
        true,
      );
      expect(MediaAssetStateMachine.canTransition('FAILED', 'PUBLISHED')).toBe(
        false,
      );
    });

    it('identifies playable and terminal states accurately', () => {
      expect(MediaAssetStateMachine.isPlayable('READY')).toBe(true);
      expect(MediaAssetStateMachine.isPlayable('PUBLISHED')).toBe(true);
      expect(MediaAssetStateMachine.isPlayable('PROCESSING')).toBe(false);
      expect(MediaAssetStateMachine.isPlayable('FAILED')).toBe(false);

      expect(MediaAssetStateMachine.isTerminal('DELETED')).toBe(true);
      expect(MediaAssetStateMachine.isTerminal('ARCHIVED')).toBe(false);
    });

    it('ignores out-of-order events once the asset is already playable or deleted', () => {
      // If asset is already READY, ignore incoming late PROCESSING or UPLOADING
      expect(
        MediaAssetStateMachine.shouldIgnoreOutOfOrder('READY', 'PROCESSING'),
      ).toBe(true);
      expect(
        MediaAssetStateMachine.shouldIgnoreOutOfOrder('READY', 'UPLOADING'),
      ).toBe(true);

      // If asset is PROCESSING, do not ignore incoming READY
      expect(
        MediaAssetStateMachine.shouldIgnoreOutOfOrder('PROCESSING', 'READY'),
      ).toBe(false);

      // If asset is DELETED, ignore everything
      expect(
        MediaAssetStateMachine.shouldIgnoreOutOfOrder('DELETED', 'PROCESSING'),
      ).toBe(true);
    });
  });

  describe('CloudflareWebhookService', () => {
    let service: CloudflareWebhookService;
    const testSecret = 'secret-test-key-321';

    beforeEach(() => {
      service = new CloudflareWebhookService();
    });

    it('verifies valid HMAC-SHA256 signature successfully', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const rawPayload = JSON.stringify({
        uid: 'cf_stream_123',
        status: { state: 'ready' },
      });
      const payloadToSign = `${timestamp}.${rawPayload}`;
      const sig1 = crypto
        .createHmac('sha256', testSecret)
        .update(payloadToSign)
        .digest('hex');
      const header = `time=${timestamp},sig1=${sig1}`;

      const isValid = service.verifyWebhookSignature(
        rawPayload,
        header,
        testSecret,
      );
      expect(isValid).toBe(true);
    });

    it('rejects an invalid signature with BadRequestException', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const rawPayload = JSON.stringify({ uid: 'cf_stream_123' });
      const badHeader = `time=${timestamp},sig1=0000000000000000000000000000000000000000000000000000000000000000`;

      expect(() =>
        service.verifyWebhookSignature(rawPayload, badHeader, testSecret),
      ).toThrow(BadRequestException);
    });

    it('rejects expired signatures (> 300 seconds old) to prevent replay attacks', () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s in the past
      const rawPayload = JSON.stringify({ uid: 'cf_stream_123' });
      const payloadToSign = `${expiredTimestamp}.${rawPayload}`;
      const sig1 = crypto
        .createHmac('sha256', testSecret)
        .update(payloadToSign)
        .digest('hex');
      const header = `time=${expiredTimestamp},sig1=${sig1}`;

      expect(() =>
        service.verifyWebhookSignature(rawPayload, header, testSecret),
      ).toThrow(BadRequestException);
    });

    it('rejects malformed signature header', () => {
      const rawPayload = JSON.stringify({ uid: 'cf_stream_123' });
      expect(() =>
        service.verifyWebhookSignature(
          rawPayload,
          'invalid-header-format',
          testSecret,
        ),
      ).toThrow(BadRequestException);
    });

    it('normalizes live stream and VOD events correctly', () => {
      // Test live input connected event
      const liveEvent = service.normalizeEvent({
        event: 'live_input.connected',
        uid: 'live_uid_456',
      });
      expect(liveEvent.eventType).toBe('live.connected');
      expect(liveEvent.assetId).toBe('live_uid_456');

      // Test VOD ready event
      const vodReadyEvent = service.normalizeEvent({
        status: { state: 'ready' },
        uid: 'vod_uid_789',
        duration: 120.5,
        playback: {
          hls: 'https://videodelivery.net/vod_uid_789/manifest/video.m3u8',
        },
      });
      expect(vodReadyEvent.eventType).toBe('video.ready');
      expect(vodReadyEvent.assetId).toBe('vod_uid_789');
      expect(vodReadyEvent.playbackUrl).toBe(
        'https://videodelivery.net/vod_uid_789/manifest/video.m3u8',
      );
      expect(vodReadyEvent.durationSeconds).toBe(120.5);

      // Test VOD failed event
      const vodFailedEvent = service.normalizeEvent({
        status: { state: 'error' },
        uid: 'vod_uid_error',
      });
      expect(vodFailedEvent.eventType).toBe('video.failed');
    });

    it('deduplicates duplicate webhook event IDs (idempotency)', async () => {
      const eventId = 'test_evt_unique_101';
      const firstResult = await service.recordEventIdempotent(
        eventId,
        'video.ready',
        'asset_101',
      );
      expect(firstResult.isDuplicate).toBe(false);

      // Second delivery of identical event ID
      const secondResult = await service.recordEventIdempotent(
        eventId,
        'video.ready',
        'asset_101',
      );
      expect(secondResult.isDuplicate).toBe(true);
    });
  });

  describe('CloudflareWebhookController', () => {
    let controller: CloudflareWebhookController;
    let service: CloudflareWebhookService;
    const testSecret = 'secret-test-key-321';

    beforeEach(() => {
      service = new CloudflareWebhookService();
      controller = new CloudflareWebhookController(service);
      process.env.CLOUDFLARE_WEBHOOK_SECRET = testSecret;
    });

    afterEach(() => {
      delete process.env.CLOUDFLARE_WEBHOOK_SECRET;
    });

    it('successfully processes valid incoming webhook', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        event_id: 'cf_req_1001',
        uid: 'video_uid_1001',
        status: { state: 'ready' },
      };
      const rawBody = JSON.stringify(payload);
      const sig1 = crypto
        .createHmac('sha256', testSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const req = {
        headers: {
          'webhook-signature': `time=${timestamp},sig1=${sig1}`,
        },
        rawBody,
      };

      const result = await controller.handleCloudflareWebhook(req, payload);
      expect(result.success).toBe(true);
      expect(result.deduplicated).toBe(false);
      expect(result.eventType).toBe('video.ready');
    });

    it('gracefully handles and ignores duplicate delivery of webhook', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        event_id: 'cf_req_dup_2002',
        uid: 'video_uid_2002',
        status: { state: 'ready' },
      };
      const rawBody = JSON.stringify(payload);
      const sig1 = crypto
        .createHmac('sha256', testSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const req = {
        headers: {
          'webhook-signature': `time=${timestamp},sig1=${sig1}`,
        },
        rawBody,
      };

      // 1st delivery
      const first = await controller.handleCloudflareWebhook(req, payload);
      expect(first.deduplicated).toBe(false);

      // 2nd delivery (duplicate)
      const second = await controller.handleCloudflareWebhook(req, payload);
      expect(second.success).toBe(true);
      expect(second.deduplicated).toBe(true);
    });

    it('rejects empty webhook payload with BadRequestException', async () => {
      const req = {
        headers: {},
        rawBody: '',
      };
      await expect(controller.handleCloudflareWebhook(req, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
