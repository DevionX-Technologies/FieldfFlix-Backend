import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import Redis, { RedisOptions } from 'ioredis';

export interface BufferedMetricDelta {
  userId: string;
  increments: Record<string, number>;
  peaks: Record<string, number>;
  flags: Record<string, boolean>;
}

@Injectable()
export class AchievementMetricsBufferService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AchievementMetricsBufferService.name);
  private redisClient: Redis | null = null;
  private isRedisConnected = false;

  // In-memory fallback buffer (used if Redis is offline or not configured)
  private memoryIncrements = new Map<string, Map<string, number>>();
  private memoryPeaks = new Map<string, Map<string, number>>();
  private memoryFlags = new Map<string, Map<string, boolean>>();
  private memoryPendingUsers = new Set<string>();

  private isFlushing = false;
  private flushListeners: Array<(deltas: BufferedMetricDelta[]) => Promise<void>> = [];

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisHost = this.configService.get<string>('REDIS_HOST');
    const redisPort = this.configService.get<number>('REDIS_PORT') || 6379;
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');
    const redisUrl = this.configService.get<string>('REDIS_URL');

    if (redisUrl || redisHost) {
      try {
        const options: RedisOptions = {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 1000)),
        };

        if (redisPassword) {
          options.password = redisPassword;
        }

        this.redisClient = redisUrl
          ? new Redis(redisUrl, options)
          : new Redis({ host: redisHost, port: redisPort, ...options });

        this.redisClient.on('connect', () => {
          this.isRedisConnected = true;
          this.logger.log('Achievement Redis metrics buffer connected.');
        });

        this.redisClient.on('error', (err) => {
          this.isRedisConnected = false;
          this.logger.warn(`Achievement Redis buffer error (fallback active): ${err.message}`);
        });

        await this.redisClient.connect().catch((err) => {
          this.logger.warn(`Redis connection failed (${err.message}). Using in-memory fallback buffer.`);
        });
      } catch (err) {
        this.logger.warn(`Failed to initialize Redis metrics buffer: ${(err as Error)?.message}`);
      }
    } else {
      this.logger.log('No Redis host configured. Using high-performance in-memory metrics buffer.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => {});
    }
  }

  public registerFlushListener(listener: (deltas: BufferedMetricDelta[]) => Promise<void>): void {
    this.flushListeners.push(listener);
  }

  /**
   * Buffer an increment to a numeric metric counter (e.g. matches_played +1, goals +2)
   */
  async bufferIncrement(userId: string, metricKey: string, delta = 1): Promise<void> {
    if (!userId || !metricKey || delta === 0) return;

    if (this.isRedisConnected && this.redisClient) {
      try {
        const pipeline = this.redisClient.pipeline();
        pipeline.hincrby(`achv:inc:${userId}`, metricKey, delta);
        pipeline.sadd('achv:pending_users', userId);
        await pipeline.exec();
        return;
      } catch (err) {
        this.logger.warn(`Redis bufferIncrement failed, falling back to memory: ${(err as Error)?.message}`);
      }
    }

    // In-memory fallback
    if (!this.memoryIncrements.has(userId)) {
      this.memoryIncrements.set(userId, new Map());
    }
    const userMap = this.memoryIncrements.get(userId)!;
    userMap.set(metricKey, (userMap.get(metricKey) || 0) + delta);
    this.memoryPendingUsers.add(userId);
  }

  /**
   * Buffer a high-water mark / peak value (e.g. peak_likes_single_short)
   */
  async bufferPeak(userId: string, metricKey: string, value: number): Promise<void> {
    if (!userId || !metricKey) return;

    if (this.isRedisConnected && this.redisClient) {
      try {
        const key = `achv:peak:${userId}`;
        const current = await this.redisClient.hget(key, metricKey);
        const currentNum = current ? Number(current) : 0;
        if (value > currentNum) {
          const pipeline = this.redisClient.pipeline();
          pipeline.hset(key, metricKey, value);
          pipeline.sadd('achv:pending_users', userId);
          await pipeline.exec();
        }
        return;
      } catch (err) {
        this.logger.warn(`Redis bufferPeak failed, falling back to memory: ${(err as Error)?.message}`);
      }
    }

    // In-memory fallback
    if (!this.memoryPeaks.has(userId)) {
      this.memoryPeaks.set(userId, new Map());
    }
    const userMap = this.memoryPeaks.get(userId)!;
    const currentVal = userMap.get(metricKey) || 0;
    if (value > currentVal) {
      userMap.set(metricKey, value);
      this.memoryPendingUsers.add(userId);
    }
  }

  /**
   * Buffer a boolean flag (e.g. beta_tester_flag)
   */
  async bufferFlag(userId: string, flagKey: string, value: boolean): Promise<void> {
    if (!userId || !flagKey) return;

    if (this.isRedisConnected && this.redisClient) {
      try {
        const pipeline = this.redisClient.pipeline();
        pipeline.hset(`achv:flags:${userId}`, flagKey, value ? '1' : '0');
        pipeline.sadd('achv:pending_users', userId);
        await pipeline.exec();
        return;
      } catch (err) {
        this.logger.warn(`Redis bufferFlag failed, falling back to memory: ${(err as Error)?.message}`);
      }
    }

    // In-memory fallback
    if (!this.memoryFlags.has(userId)) {
      this.memoryFlags.set(userId, new Map());
    }
    this.memoryFlags.get(userId)!.set(flagKey, value);
    this.memoryPendingUsers.add(userId);
  }

  /**
   * Periodic cron trigger for reliable persistence and aggregation
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleScheduledFlush(): Promise<void> {
    await this.flushMetrics();
  }

  /**
   * Flush Strategy: Persist buffered metrics reliably without losing activity during aggregation cycles.
   * Atomically drains the buffer into batch deltas and invokes registered listeners.
   */
  async flushMetrics(): Promise<BufferedMetricDelta[]> {
    if (this.isFlushing) {
      return [];
    }

    this.isFlushing = true;
    const deltas: BufferedMetricDelta[] = [];

    try {
      // 1. Drain Redis buffer if active
      if (this.isRedisConnected && this.redisClient) {
        try {
          const pendingUsers = await this.redisClient.smembers('achv:pending_users');
          if (pendingUsers.length > 0) {
            for (const userId of pendingUsers) {
              const incKey = `achv:inc:${userId}`;
              const peakKey = `achv:peak:${userId}`;
              const flagKey = `achv:flags:${userId}`;

              const [rawIncs, rawPeaks, rawFlags] = await Promise.all([
                this.redisClient.hgetall(incKey),
                this.redisClient.hgetall(peakKey),
                this.redisClient.hgetall(flagKey),
              ]);

              // Atomic delete of processed keys
              await this.redisClient.del(incKey, peakKey, flagKey);
              await this.redisClient.srem('achv:pending_users', userId);

              const increments: Record<string, number> = {};
              for (const [k, v] of Object.entries(rawIncs || {})) {
                increments[k] = Number(v);
              }

              const peaks: Record<string, number> = {};
              for (const [k, v] of Object.entries(rawPeaks || {})) {
                peaks[k] = Number(v);
              }

              const flags: Record<string, boolean> = {};
              for (const [k, v] of Object.entries(rawFlags || {})) {
                flags[k] = v === '1' || v === 'true';
              }

              if (
                Object.keys(increments).length > 0 ||
                Object.keys(peaks).length > 0 ||
                Object.keys(flags).length > 0
              ) {
                deltas.push({ userId, increments, peaks, flags });
              }
            }
          }
        } catch (err) {
          this.logger.error(`Error draining Redis metrics buffer: ${(err as Error)?.message}`);
        }
      }

      // 2. Drain in-memory buffer
      if (this.memoryPendingUsers.size > 0) {
        const usersToFlush = Array.from(this.memoryPendingUsers);
        this.memoryPendingUsers.clear();

        for (const userId of usersToFlush) {
          const userIncs = this.memoryIncrements.get(userId);
          const userPeaks = this.memoryPeaks.get(userId);
          const userFlags = this.memoryFlags.get(userId);

          this.memoryIncrements.delete(userId);
          this.memoryPeaks.delete(userId);
          this.memoryFlags.delete(userId);

          const increments: Record<string, number> = {};
          if (userIncs) {
            userIncs.forEach((v, k) => (increments[k] = v));
          }

          const peaks: Record<string, number> = {};
          if (userPeaks) {
            userPeaks.forEach((v, k) => (peaks[k] = v));
          }

          const flags: Record<string, boolean> = {};
          if (userFlags) {
            userFlags.forEach((v, k) => (flags[k] = v));
          }

          if (
            Object.keys(increments).length > 0 ||
            Object.keys(peaks).length > 0 ||
            Object.keys(flags).length > 0
          ) {
            deltas.push({ userId, increments, peaks, flags });
          }
        }
      }

      // 3. Notify registered persistence listeners
      if (deltas.length > 0) {
        for (const listener of this.flushListeners) {
          try {
            await listener(deltas);
          } catch (err) {
            this.logger.error(`Flush listener execution failed: ${(err as Error)?.message ?? err}`);
          }
        }
        this.logger.debug(`Flushed metrics buffer for ${deltas.length} users`);
      }
    } finally {
      this.isFlushing = false;
    }

    return deltas;
  }

  /**
   * Buffer observability metrics
   */
  getBufferStats(): {
    isRedisConnected: boolean;
    pendingMemoryUsers: number;
    isFlushing: boolean;
  } {
    return {
      isRedisConnected: this.isRedisConnected,
      pendingMemoryUsers: this.memoryPendingUsers.size,
      isFlushing: this.isFlushing,
    };
  }
}
