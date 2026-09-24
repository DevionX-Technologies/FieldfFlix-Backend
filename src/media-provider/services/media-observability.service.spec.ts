import { MediaObservabilityService } from './media-observability.service';

describe('MediaObservabilityService', () => {
  let service: MediaObservabilityService;

  beforeEach(() => {
    service = new MediaObservabilityService();
  });

  describe('sanitize', () => {
    it('redacts sensitive keys in objects', () => {
      const input = {
        tournamentId: 'tourn-1',
        streamKey: 'live_st_secret_abc123',
        apiToken: 'cf_tok_secret_456',
        details: {
          jwtToken: 'bearer.token.payload',
          courtId: 'court-3',
          nested: {
            signedUrl:
              'https://videodelivery.net/jwt_token/manifest/video.m3u8',
          },
        },
      };

      const sanitized = service.sanitize(input);

      expect(sanitized.tournamentId).toBe('tourn-1');
      expect(sanitized.streamKey).toBe('[REDACTED]');
      expect(sanitized.apiToken).toBe('[REDACTED]');
      expect(sanitized.details.jwtToken).toBe('[REDACTED]');
      expect(sanitized.details.courtId).toBe('court-3');
      expect(sanitized.details.nested.signedUrl).toBe('[REDACTED]');
    });

    it('returns primitive values unchanged', () => {
      expect(service.sanitize(null)).toBeNull();
      expect(service.sanitize('test-string')).toBe('test-string');
      expect(service.sanitize(42)).toBe(42);
    });
  });

  describe('logMediaEvent & logMediaError', () => {
    it('logs structured events and increments event counters', () => {
      const context = {
        tournamentId: 't-101',
        courtId: 'court-1',
        provider: 'cloudflare' as const,
      };

      service.logMediaEvent('live_stream_started', context, {
        streamKey: 'super_secret_stream_key',
        resolution: '1080p',
      });

      const snapshot = service.getMetricsSnapshot();
      expect(snapshot.counters['media_event_live_stream_started_total']).toBe(
        1,
      );
    });

    it('logs media errors and increments error counters', () => {
      const context = {
        recordingId: 'rec-999',
        provider: 'cloudflare' as const,
      };
      const testError = new Error('Cloudflare Stream ingest failed with 500');

      service.logMediaError('vod_ingest_failed', testError, context);

      const snapshot = service.getMetricsSnapshot();
      expect(snapshot.counters['media_error_vod_ingest_failed_total']).toBe(1);
    });
  });

  describe('startTimer and latency tracking', () => {
    it('measures operation duration and computes latency statistics', async () => {
      const timer = service.startTimer('vod_transcode_latency', {
        recordingId: 'rec-1',
      });

      // Simulate a small delay
      await new Promise((resolve) => setTimeout(resolve, 15));

      const duration = timer.stop({ status: 'ready' });
      expect(duration).toBeGreaterThanOrEqual(10);

      const snapshot = service.getMetricsSnapshot();
      expect(snapshot.latencies['vod_transcode_latency']).toBeDefined();
      expect(snapshot.latencies['vod_transcode_latency'].count).toBe(1);
      expect(
        snapshot.latencies['vod_transcode_latency'].avgMs,
      ).toBeGreaterThanOrEqual(10);
    });

    it('tracks failed operations when timer.fail is called', async () => {
      const timer = service.startTimer('live_provisioning', {
        courtId: 'court-2',
      });

      timer.fail(new Error('Connection timed out'));

      const snapshot = service.getMetricsSnapshot();
      expect(snapshot.latencies['live_provisioning_failed']).toBeDefined();
      expect(snapshot.latencies['live_provisioning_failed'].count).toBe(1);
    });
  });
});
