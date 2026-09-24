import { Injectable, Logger } from '@nestjs/common';

export interface MediaCorrelationContext {
  traceId?: string;
  requestId?: string;
  tenantId?: string;
  tournamentId?: string;
  matchId?: string;
  courtId?: string;
  recordingId?: string;
  assetId?: string;
  liveSessionId?: string;
  jobId?: string;
  provider?: 'mux' | 'cloudflare' | 's3' | 'r2' | string;
}

export interface MetricEntry {
  name: string;
  value: number;
  tags?: Record<string, string | number>;
  timestamp: string;
}

const SENSITIVE_KEYS = [
  'key',
  'streamkey',
  'token',
  'secret',
  'password',
  'authorization',
  'jwt',
  'bearer',
  'signedurl',
  'playbackurl',
  'r2secretaccesskey',
  'cloudflarestreamapitoken',
  'muxtokensecret',
];

@Injectable()
export class MediaObservabilityService {
  private readonly logger = new Logger(MediaObservabilityService.name);
  private readonly metrics: Map<string, number> = new Map();
  private readonly latencySamples: Map<string, number[]> = new Map();

  /**
   * Redacts sensitive information from any object before logging.
   */
  public sanitize(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = SENSITIVE_KEYS.some((s) => lowerKey.includes(s));

      if (isSensitive && typeof value === 'string') {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Logs a structured media event with correlation metadata.
   */
  public logMediaEvent(
    eventType: string,
    context: MediaCorrelationContext = {},
    details?: Record<string, any>,
  ): void {
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      correlation: context,
      details: this.sanitize(details),
    };

    this.logger.log(`[MediaEvent:${eventType}] ${JSON.stringify(payload)}`);
    this.incrementMetric(`media_event_${eventType}_total`);
  }

  /**
   * Logs a media workflow warning or failure with correlation.
   */
  public logMediaWarning(
    eventType: string,
    message: string,
    context: MediaCorrelationContext = {},
    details?: Record<string, any>,
  ): void {
    const payload = {
      event: eventType,
      message,
      timestamp: new Date().toISOString(),
      correlation: context,
      details: this.sanitize(details),
    };

    this.logger.warn(`[MediaWarn:${eventType}] ${JSON.stringify(payload)}`);
    this.incrementMetric(`media_warn_${eventType}_total`);
  }

  /**
   * Logs a media workflow error with error details and correlation.
   */
  public logMediaError(
    eventType: string,
    error: any,
    context: MediaCorrelationContext = {},
    details?: Record<string, any>,
  ): void {
    const errorMessage = error?.message || String(error);
    const errorStack = error?.stack;

    const payload = {
      event: eventType,
      error: errorMessage,
      timestamp: new Date().toISOString(),
      correlation: context,
      details: this.sanitize(details),
    };

    this.logger.error(
      `[MediaError:${eventType}] ${JSON.stringify(payload)}`,
      errorStack,
    );
    this.incrementMetric(`media_error_${eventType}_total`);
  }

  /**
   * Increments an in-memory counter metric.
   */
  public incrementMetric(name: string, step = 1): void {
    const current = this.metrics.get(name) || 0;
    this.metrics.set(name, current + step);
  }

  /**
   * Records a latency/duration metric and preserves a rolling window of recent samples.
   */
  public recordDuration(operation: string, durationMs: number): void {
    this.incrementMetric(`${operation}_count`);
    this.incrementMetric(`${operation}_sum_ms`, durationMs);

    const samples = this.latencySamples.get(operation) || [];
    samples.push(durationMs);
    if (samples.length > 100) {
      samples.shift();
    }
    this.latencySamples.set(operation, samples);
  }

  /**
   * Starts a timer for an operation and returns a stop function that records latency and logs completion.
   */
  public startTimer(
    operationName: string,
    context: MediaCorrelationContext = {},
  ) {
    const start = Date.now();
    return {
      stop: (details?: Record<string, any>) => {
        const durationMs = Date.now() - start;
        this.recordDuration(operationName, durationMs);
        this.logMediaEvent(`${operationName}_completed`, context, {
          ...details,
          durationMs,
        });
        return durationMs;
      },
      fail: (error: any, details?: Record<string, any>) => {
        const durationMs = Date.now() - start;
        this.recordDuration(`${operationName}_failed`, durationMs);
        this.logMediaError(`${operationName}_failed`, error, context, {
          ...details,
          durationMs,
        });
        return durationMs;
      },
    };
  }

  /**
   * Returns a snapshot of accumulated in-memory metrics and average latencies.
   */
  public getMetricsSnapshot(): Record<string, any> {
    const counters: Record<string, number> = {};
    for (const [key, val] of this.metrics.entries()) {
      counters[key] = val;
    }

    const latencies: Record<
      string,
      { count: number; avgMs: number; p95Ms: number }
    > = {};
    for (const [op, samples] of this.latencySamples.entries()) {
      if (samples.length > 0) {
        const sorted = [...samples].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const avg = Math.round(sum / sorted.length);
        const p95Index = Math.min(
          sorted.length - 1,
          Math.floor(sorted.length * 0.95),
        );
        latencies[op] = {
          count: sorted.length,
          avgMs: avg,
          p95Ms: sorted[p95Index],
        };
      }
    }

    return {
      timestamp: new Date().toISOString(),
      counters,
      latencies,
    };
  }
}
