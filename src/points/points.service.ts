import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { PointEvent, PointEventType } from './entities/point-event.entity';
import { PointConfig } from './entities/point-config.entity';
import { UserPoints } from './entities/user-points.entity';
import { User } from 'src/user/entities/user.entity';
import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { FireBaseNotificationService } from 'src/common/service/fire-base.service';
import { MessageStatus, NotificationType } from 'src/constant/enum';

/**
 * Default per-event point values + admin-facing labels. Used to seed
 * `point_configs` on first boot, and as a fallback when a config row is
 * missing (e.g. between code releases that introduce a new event type).
 */
const DEFAULT_CONFIGS: Record<
  PointEventType,
  { points: number; label: string }
> = {
  [PointEventType.RECORDING_CREATE]: {
    points: 5,
    label: 'Created a session recording',
  },
  [PointEventType.RECORDING_SHARE]: { points: 2, label: 'Shared a recording' },
  [PointEventType.RECORDING_RECEIVE]: {
    points: 1,
    label: 'Received a shared recording',
  },
  [PointEventType.PAYMENT_COMPLETE]: {
    points: 1,
    label: 'Completed a payment',
  },
  [PointEventType.FLICKSHORT_APPROVED]: {
    points: 2,
    label: 'Highlight approved for FlickShorts',
  },
};

@Injectable()
export class PointsService implements OnModuleInit {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PointEvent)
    private readonly eventRepo: Repository<PointEvent>,
    @InjectRepository(PointConfig)
    private readonly configRepo: Repository<PointConfig>,
    @InjectRepository(UserPoints)
    private readonly userPointsRepo: Repository<UserPoints>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    private readonly fireBaseNotificationService: FireBaseNotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaults();
  }

  /**
   * Insert any missing default config rows. Idempotent — safe to run on every
   * boot. Doesn't overwrite existing rows (so an admin-customized value is
   * preserved across deploys).
   */
  async ensureDefaults(): Promise<void> {
    const existing = await this.configRepo.find();
    const have = new Set(existing.map((c) => c.eventType));
    const toInsert: PointConfig[] = [];
    for (const [type, def] of Object.entries(DEFAULT_CONFIGS) as Array<
      [PointEventType, { points: number; label: string }]
    >) {
      if (have.has(type)) continue;
      toInsert.push(
        this.configRepo.create({
          eventType: type,
          points: def.points,
          label: def.label,
          enabled: true,
        }),
      );
    }
    if (toInsert.length > 0) {
      await this.configRepo.save(toInsert);
      this.logger.log(
        `Seeded ${toInsert.length} default point configs: ${toInsert
          .map((c) => c.eventType)
          .join(', ')}`,
      );
    }
  }

  /**
   * Build the unique idempotency key for an award. Repeat awards with the
   * same key collapse via the UNIQUE index on PointEvent.idempotencyKey.
   */
  private buildIdempotencyKey(
    eventType: PointEventType,
    userId: string,
    refId: string | null,
  ): string {
    const raw = `${eventType}::${userId}::${refId ?? ''}`;
    // Hashed so the column stays within length even with long composite refs.
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Award points to a user for an event. Idempotent: a second call with the
   * same (eventType, userId, refId) is a no-op. Runs in a single transaction
   * so the PointEvent insert and UserPoints upsert can't desync.
   *
   * Returns `null` when the award was skipped (already credited or config
   * disabled), or the persisted PointEvent row on success.
   */
  async awardPoints(args: {
    userId: string;
    eventType: PointEventType;
    refId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<PointEvent | null> {
    const { userId, eventType, refId = null, metadata = null } = args;
    if (!userId) return null;

    const config = await this.configRepo.findOne({ where: { eventType } });
    const def = DEFAULT_CONFIGS[eventType];
    const enabled = config?.enabled ?? true;
    const value = config?.points ?? def?.points ?? 0;

    if (!enabled || value <= 0) {
      return null;
    }

    const idempotencyKey = this.buildIdempotencyKey(eventType, userId, refId);

    return this.dataSource
      .transaction(async (manager) => {
        // Pre-check by idempotencyKey so we don't waste the upsert when this is
        // a duplicate (and so we can return the existing row).
        const existing = await manager.getRepository(PointEvent).findOne({
          where: { idempotencyKey },
        });
        if (existing) {
          return null;
        }

        const event = manager.getRepository(PointEvent).create({
          userId,
          eventType,
          refId,
          idempotencyKey,
          points: value,
          metadata,
        });
        let saved: PointEvent;
        try {
          saved = await manager.getRepository(PointEvent).save(event);
        } catch (err: unknown) {
          // Race with another concurrent insert — the unique index caught it.
          if (
            err &&
            typeof err === 'object' &&
            'code' in err &&
            String((err as { code: string }).code) === '23505'
          ) {
            return null;
          }
          throw err;
        }

        // Upsert user_points total. INSERT ... ON CONFLICT keeps writes atomic.
        await manager
          .getRepository(UserPoints)
          .createQueryBuilder()
          .insert()
          .values({ userId, totalPoints: value })
          .orUpdate(['totalPoints'], ['userId'], {
            skipUpdateIfNoValuesChanged: false,
          })
          .setParameter('inc', value)
          .execute()
          .catch(async () => {
            // Fallback path for environments where ON CONFLICT setParameter isn't
            // honoured the way we want. Issue an explicit UPDATE that increments.
            await manager
              .getRepository(UserPoints)
              .createQueryBuilder()
              .update()
              .set({
                totalPoints: () => `"totalPoints" + ${value}`,
              })
              .where('userId = :userId', { userId })
              .execute();
          });

        // Make doubly sure: if the user had no prior row and the upsert above
        // inserted a fresh row with totalPoints=value, the explicit increment
        // path would double-count. Resolve by reading + reconciling.
        const row = await manager
          .getRepository(UserPoints)
          .findOne({ where: { userId } });
        if (!row) {
          await manager.getRepository(UserPoints).insert({
            userId,
            totalPoints: value,
          });
        }

        this.logger.debug(
          `Awarded ${value} pts to user ${userId} for ${eventType} (ref=${refId ?? '-'})`,
        );
        return saved;
      })
      .then(async (saved) => {
        // Fire a notification AFTER the award transaction commits — outside the
        // tx so a notification failure can never roll the points back. Best
        // effort: any error is logged but never bubbles up. Skip when `saved`
        // is null (already-awarded / no-op).
        if (saved) {
          const label =
            config?.label ?? def?.label ?? this.humanizeEventType(eventType);
          void this.fireAwardNotification({
            userId,
            eventType,
            points: value,
            label,
          }).catch((err) =>
            this.logger.warn(
              `points award notification failed for user=${userId} event=${eventType}: ${(err as Error)?.message ?? err}`,
            ),
          );
        }
        return saved;
      });
  }

  /**
   * Build and dispatch the celebration notification for a points award.
   *
   *   1. Look up every FCM device token for this user.
   *   2. Push a notification per token via `FireBaseNotificationService`,
   *      including a `data` payload (`eventType`, `points`, `totalPoints`,
   *      `label`) that the mobile app reads to render an in-app celebration
   *      toast and refresh the Profile points pill without a refetch.
   *   3. Persist a row in `notifications` so it also appears in the in-app
   *      notification list (same pattern as RECORDING_START etc.).
   *
   * Idempotency is already enforced at the award layer (one PointEvent per
   * (eventType, userId, refId)), so re-deliveries of the same event will not
   * produce duplicate notifications.
   */
  private async fireAwardNotification(args: {
    userId: string;
    eventType: PointEventType;
    points: number;
    label: string;
  }): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: args.userId },
      relations: ['user_devices_token'],
    });
    if (!user) return;
    const totals = await this.userPointsRepo.findOne({
      where: { userId: args.userId },
    });
    const totalPoints = totals?.totalPoints ?? args.points;

    const title = `+${args.points} pts! 🎉`;
    const body = `${args.label} — you now have ${totalPoints} pts.`;

    // Push to every device the user has registered. We swallow per-device
    // errors so a single bad token doesn't kill the loop for the rest.
    const tokens = user.user_devices_token ?? [];
    for (const t of tokens) {
      const token = (t as { devices_id?: string })?.devices_id;
      if (!token) continue;
      try {
        await this.fireBaseNotificationService.sendNotification(
          {
            notification: { title, body },
            token,
            // FCM `data` is loosely typed at the consumer side — cast to a
            // generic record so additional keys (event metadata) survive the
            // transport. The mobile app reads them in its FCM handler to
            // drive the celebration toast + Profile pill refresh.
            data: {
              click_action: 'POINTS_AWARDED',
              type: 'POINTS_AWARDED',
              eventType: String(args.eventType),
              points: String(args.points),
              totalPoints: String(totalPoints),
              label: args.label,
            } as unknown as { click_action: string },
          },
          user.id,
        );
      } catch (err) {
        this.logger.warn(
          `FCM send failed for user=${user.id} token=${token.slice(0, 8)}…: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    // Persist the in-app notification row so the user's notification list
    // also gets this entry, just like RECORDING_START / RECORDING_STOP do.
    try {
      // `data` is typed as `any[]` on the entity but is used as a JSONB blob
      // in practice — wrap in an array so the column accepts the payload.
      await this.notificationRepo.save({
        user_id: user.id,
        title,
        body,
        data: [
          {
            eventType: args.eventType,
            points: args.points,
            totalPoints,
            label: args.label,
          },
        ],
        message_status: MessageStatus.UNREAD,
        notification_type: NotificationType.POINTS_AWARDED,
        is_soft_delete: false,
      } as unknown as Partial<NotificationEntity>);
    } catch (err) {
      this.logger.warn(
        `failed to persist POINTS_AWARDED notification for user=${user.id}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /** Friendly fallback when no config row carries a custom label. */
  private humanizeEventType(eventType: PointEventType): string {
    return String(eventType).replace(/_/g, ' ');
  }

  /** Current total + breakdown for a user. */
  async getMyTotals(userId: string): Promise<{
    totalPoints: number;
    perEvent: Array<{
      eventType: PointEventType;
      points: number;
      count: number;
    }>;
  }> {
    const total = await this.userPointsRepo.findOne({ where: { userId } });
    const rows = await this.eventRepo
      .createQueryBuilder('e')
      .select('e.eventType', 'eventType')
      .addSelect('SUM(e.points)', 'points')
      .addSelect('COUNT(*)', 'count')
      .where('e.userId = :userId', { userId })
      .groupBy('e.eventType')
      .getRawMany<{
        eventType: PointEventType;
        points: string;
        count: string;
      }>();
    const perEvent = rows.map((r) => ({
      eventType: r.eventType,
      points: Number(r.points ?? 0),
      count: Number(r.count ?? 0),
    }));
    return { totalPoints: total?.totalPoints ?? 0, perEvent };
  }

  /** Recent point-award timeline for a user (newest first). */
  async getMyRecentEvents(userId: string, limit = 30): Promise<PointEvent[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return this.eventRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: safeLimit,
    });
  }

  /** All admin-editable configs, with defaults filled in for any missing rows. */
  async listConfigs(): Promise<
    Array<{
      eventType: PointEventType;
      label: string;
      points: number;
      enabled: boolean;
    }>
  > {
    const rows = await this.configRepo.find();
    const byType = new Map(rows.map((r) => [r.eventType, r]));
    const out: Array<{
      eventType: PointEventType;
      label: string;
      points: number;
      enabled: boolean;
    }> = [];
    for (const [type, def] of Object.entries(DEFAULT_CONFIGS) as Array<
      [PointEventType, { points: number; label: string }]
    >) {
      const r = byType.get(type);
      out.push({
        eventType: type,
        label: r?.label ?? def.label,
        points: r?.points ?? def.points,
        enabled: r?.enabled ?? true,
      });
    }
    return out;
  }

  /**
   * Leaderboard period helpers.
   *
   *   - `weekly` window: Monday 00:00 IST (UTC+05:30) → next Monday 00:00 IST
   *   - `monthly` window: 1st 00:00 IST → 1st of next month 00:00 IST
   *
   * IST is chosen because both fielfflicks venues and the user base are
   * India-based. Compute is done in UTC; we shift epochs by +5h30m so the
   * boundary aligns with the user's wall clock without needing pg_timezone.
   */
  private readonly IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

  private periodWindow(
    period: 'weekly' | 'monthly' | 'all',
    nowMs = Date.now(),
  ): { start: Date | null; end: Date | null } {
    if (period === 'all') return { start: null, end: null };

    const istNow = new Date(nowMs + this.IST_OFFSET_MS);
    const istY = istNow.getUTCFullYear();
    const istM = istNow.getUTCMonth();
    const istD = istNow.getUTCDate();

    if (period === 'monthly') {
      const startIstMs = Date.UTC(istY, istM, 1, 0, 0, 0);
      const endIstMs = Date.UTC(istY, istM + 1, 1, 0, 0, 0);
      return {
        start: new Date(startIstMs - this.IST_OFFSET_MS),
        end: new Date(endIstMs - this.IST_OFFSET_MS),
      };
    }

    // weekly: Monday-start. JS Sunday=0 → shift so Monday=0.
    const istDow = istNow.getUTCDay();
    const daysSinceMonday = (istDow + 6) % 7;
    const startIstMs = Date.UTC(istY, istM, istD - daysSinceMonday, 0, 0, 0);
    const endIstMs = startIstMs + 7 * 24 * 60 * 60 * 1000;
    return {
      start: new Date(startIstMs - this.IST_OFFSET_MS),
      end: new Date(endIstMs - this.IST_OFFSET_MS),
    };
  }

  /**
   * Leaderboard for the given period. Aggregates `point_events` by user
   * inside the window (or uses denormalized `user_points` for `all`).
   * Joins the `users` table for display name + avatar.
   *
   * Returned ranks are 1-based; ties share a rank ("competition" ranking).
   */
  async getLeaderboard(
    period: 'weekly' | 'monthly' | 'all',
    limit = 50,
  ): Promise<{
    period: 'weekly' | 'monthly' | 'all';
    periodStart: string | null;
    periodEnd: string | null;
    rows: Array<{
      rank: number;
      userId: string;
      name: string | null;
      profileImagePath: string | null;
      points: number;
    }>;
  }> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const { start, end } = this.periodWindow(period);

    const qb = this.eventRepo
      .createQueryBuilder('e')
      .innerJoin('users', 'u', 'u.id = e."userId"')
      .select('e."userId"', 'userId')
      .addSelect('u.name', 'name')
      .addSelect('u.profile_image_path', 'profileImagePath')
      .addSelect('SUM(e.points)', 'points')
      .groupBy('e."userId"')
      .addGroupBy('u.name')
      .addGroupBy('u.profile_image_path')
      .orderBy('points', 'DESC')
      .addOrderBy('e."userId"', 'ASC')
      .limit(safeLimit);

    if (start) qb.andWhere('e."createdAt" >= :start', { start });
    if (end) qb.andWhere('e."createdAt" < :end', { end });

    const rawRows = await qb.getRawMany<{
      userId: string;
      name: string | null;
      profileImagePath: string | null;
      points: string;
    }>();

    // Competition ranking: same points → same rank; next distinct points
    // gets `prevRank + groupSize`.
    let prevPoints: number | null = null;
    let currentRank = 0;
    const rows = rawRows.map((r, idx) => {
      const pts = Number(r.points ?? 0);
      if (pts !== prevPoints) {
        currentRank = idx + 1;
        prevPoints = pts;
      }
      return {
        rank: currentRank,
        userId: String(r.userId),
        name: r.name,
        profileImagePath: r.profileImagePath,
        points: pts,
      };
    });

    return {
      period,
      periodStart: start ? start.toISOString() : null,
      periodEnd: end ? end.toISOString() : null,
      rows,
    };
  }

  async updateConfig(
    eventType: PointEventType,
    patch: Partial<{ points: number; label: string; enabled: boolean }>,
  ): Promise<PointConfig> {
    let row = await this.configRepo.findOne({ where: { eventType } });
    if (!row) {
      const def = DEFAULT_CONFIGS[eventType];
      row = this.configRepo.create({
        eventType,
        points: def?.points ?? 0,
        label: def?.label ?? eventType,
        enabled: true,
      });
    }
    if (patch.points != null && patch.points >= 0) row.points = patch.points;
    if (patch.label != null && patch.label.trim().length > 0)
      row.label = patch.label.trim();
    if (patch.enabled != null) row.enabled = patch.enabled;
    return this.configRepo.save(row);
  }
}
