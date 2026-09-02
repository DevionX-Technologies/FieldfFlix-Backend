import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { PointEvent, PointEventType } from './entities/point-event.entity';
import { PointConfig } from './entities/point-config.entity';
import { LevelConfig } from './entities/level-config.entity';
import { UserPoints } from './entities/user-points.entity';
import { User } from 'src/user/entities/user.entity';
import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { FireBaseNotificationService } from 'src/common/service/fire-base.service';
import { MessageStatus, NotificationType } from 'src/constant/enum';

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

const DEFAULT_LEVELS = [
  { level: 1, minPoints: 0, name: 'Bronze' },
  { level: 2, minPoints: 10, name: 'Silver' },
  { level: 3, minPoints: 30, name: 'Gold' },
  { level: 4, minPoints: 60, name: 'Pro' },
  { level: 5, minPoints: 100, name: 'Legend' },
];

@Injectable()
export class PointsService implements OnModuleInit {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PointEvent)
    private readonly eventRepo: Repository<PointEvent>,
    @InjectRepository(PointConfig)
    private readonly configRepo: Repository<PointConfig>,
    @InjectRepository(LevelConfig)
    private readonly levelConfigRepo: Repository<LevelConfig>,
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
    await this.ensureDefaultLevels();
  }

  async ensureDefaultLevels(): Promise<void> {
    const existing = await this.levelConfigRepo.find();
    if (existing.length === 0) {
      const toInsert = DEFAULT_LEVELS.map((dl) =>
        this.levelConfigRepo.create({
          level: dl.level,
          minPoints: dl.minPoints,
          name: dl.name,
        }),
      );
      await this.levelConfigRepo.save(toInsert);
      this.logger.log(
        `Seeded ${toInsert.length} default level configurations.`,
      );
    }
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

        // Upsert user_points total — must INCREMENT on conflict, not overwrite.
        await manager.query(
          `INSERT INTO user_points ("userId", "totalPoints")
           VALUES ($1, $2)
           ON CONFLICT ("userId")
           DO UPDATE SET "totalPoints" = user_points."totalPoints" + EXCLUDED."totalPoints"`,
          [userId, value],
        );

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
    const body = `${args.label} - you now have ${totalPoints} pts.`;

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
    level: number;
    levelName: string | null;
    nextLevelPoints: number | null;
    levelProgress: number;
  }> {
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

    const totalPoints = perEvent.reduce((sum, row) => sum + row.points, 0);
    await this.reconcileUserPointsCache(userId, totalPoints);

    const levelData = await this.calculateLevel(totalPoints);

    return {
      totalPoints,
      perEvent,
      ...levelData,
    };
  }

  /** Keep denormalized cache aligned with point_events ledger. */
  async reconcileUserPointsCache(
    userId: string,
    totalPoints?: number,
  ): Promise<void> {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return;
    }
    const total =
      totalPoints ??
      Number(
        (
          await this.eventRepo
            .createQueryBuilder('e')
            .select('COALESCE(SUM(e.points), 0)', 'total')
            .where('e.userId = :userId', { userId })
            .getRawOne<{ total: string }>()
        )?.total ?? 0,
      );

    await this.userPointsRepo
      .createQueryBuilder()
      .insert()
      .values({ userId, totalPoints: total })
      .orUpdate(['totalPoints'], ['userId'])
      .execute();
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
    period: 'daily' | 'today' | 'weekly' | 'monthly' | 'all',
    nowMs = Date.now(),
  ): { start: Date | null; end: Date | null } {
    if (period === 'all') return { start: null, end: null };

    const istNow = new Date(nowMs + this.IST_OFFSET_MS);
    const istY = istNow.getUTCFullYear();
    const istM = istNow.getUTCMonth();
    const istD = istNow.getUTCDate();

    if (period === 'daily' || period === 'today') {
      const startIstMs = Date.UTC(istY, istM, istD, 0, 0, 0);
      const endIstMs = startIstMs + 24 * 60 * 60 * 1000;
      return {
        start: new Date(startIstMs - this.IST_OFFSET_MS),
        end: new Date(endIstMs - this.IST_OFFSET_MS),
      };
    }

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
    period: 'daily' | 'today' | 'weekly' | 'monthly' | 'all',
    limit = 50,
    currentUserId?: string,
  ): Promise<{
    period: 'daily' | 'today' | 'weekly' | 'monthly' | 'all';
    periodStart: string | null;
    periodEnd: string | null;
    rows: Array<{
      rank: number;
      userId: string;
      name: string | null;
      profileImagePath: string | null;
      points: number;
      streak: number;
      accuracy: number;
      matches: number;
      highlightClips: number;
    }>;
    me: {
      rank: number | null;
      userId: string;
      name: string | null;
      profileImagePath: string | null;
      points: number;
      streak: number;
      accuracy: number;
    } | null;
  }> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const { start, end } = this.periodWindow(period);

    const qb = this.eventRepo
      .createQueryBuilder('e')
      .innerJoin('users', 'u', 'u.id = e."userId"')
      .leftJoin('user_points', 'up', 'up."userId" = e."userId"')
      .select('e."userId"', 'userId')
      .addSelect('u.name', 'name')
      .addSelect('u.profile_image_path', 'profileImagePath')
      .addSelect('SUM(e.points)', 'points')
      .addSelect('COALESCE(up.current_streak, 0)', 'streak')
      .addSelect('COALESCE(up.accuracy_percent, 0)', 'accuracy')
      .addSelect(
        `(SELECT COUNT(*)::int FROM recordings r WHERE r."userId" = e."userId" AND r.status IN ('ready','completed'))`,
        'matches',
      )
      .addSelect(
        `(SELECT COUNT(*)::int FROM recording_highlights rh INNER JOIN recordings r ON r.id = rh.recording_id WHERE r."userId" = e."userId")`,
        'highlightClips',
      )
      .groupBy('e."userId"')
      .addGroupBy('u.name')
      .addGroupBy('u.profile_image_path')
      .addGroupBy('up.current_streak')
      .addGroupBy('up.accuracy_percent')
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
      streak: string;
      accuracy: string;
      matches: string;
      highlightClips: string;
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
        streak: Number(r.streak ?? 0),
        accuracy: Number(r.accuracy ?? 0),
        matches: Number(r.matches ?? 0),
        highlightClips: Number(r.highlightClips ?? 0),
      };
    });

    return {
      period,
      periodStart: start ? start.toISOString() : null,
      periodEnd: end ? end.toISOString() : null,
      rows,
      me: currentUserId
        ? await this.getUserPeriodRank(currentUserId, period, rows)
        : null,
    };
  }

  /** Rank + stats for one user in a leaderboard period (even if outside top N). */
  private async getUserPeriodRank(
    userId: string,
    period: 'daily' | 'today' | 'weekly' | 'monthly' | 'all',
    topRows: Array<{ userId: string; points: number; rank: number }>,
  ): Promise<{
    rank: number | null;
    userId: string;
    name: string | null;
    profileImagePath: string | null;
    points: number;
    streak: number;
    accuracy: number;
  }> {
    const inTop = topRows.find((r) => r.userId === userId);
    if (inTop) {
      const full = await this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'name', 'profile_image_path'],
      });
      const up = await this.userPointsRepo.findOne({ where: { userId } });
      return {
        rank: inTop.rank,
        userId,
        name: full?.name ?? null,
        profileImagePath: full?.profile_image_path ?? null,
        points: inTop.points,
        streak: up?.currentStreak ?? 0,
        accuracy: Number(up?.accuracyPercent ?? 0),
      };
    }

    const { start, end } = this.periodWindow(period);
    const ptsQb = this.eventRepo
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.points), 0)', 'points')
      .where('e."userId" = :userId', { userId });
    if (start) ptsQb.andWhere('e."createdAt" >= :start', { start });
    if (end) ptsQb.andWhere('e."createdAt" < :end', { end });
    const ptsRow = await ptsQb.getRawOne<{ points: string }>();
    const points = Number(ptsRow?.points ?? 0);
    if (points <= 0) {
      const full = await this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'name', 'profile_image_path'],
      });
      const up = await this.userPointsRepo.findOne({ where: { userId } });
      return {
        rank: null,
        userId,
        name: full?.name ?? null,
        profileImagePath: full?.profile_image_path ?? null,
        points: 0,
        streak: up?.currentStreak ?? 0,
        accuracy: Number(up?.accuracyPercent ?? 0),
      };
    }

    const higherQb = this.eventRepo
      .createQueryBuilder('e')
      .select('e."userId"', 'userId')
      .addSelect('SUM(e.points)', 'points')
      .groupBy('e."userId"')
      .having('SUM(e.points) > :points', { points });
    if (start) higherQb.andWhere('e."createdAt" >= :start', { start });
    if (end) higherQb.andWhere('e."createdAt" < :end', { end });
    const higherCount = (await higherQb.getRawMany()).length;

    const full = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'name', 'profile_image_path'],
    });
    const up = await this.userPointsRepo.findOne({ where: { userId } });

    return {
      rank: higherCount + 1,
      userId,
      name: full?.name ?? null,
      profileImagePath: full?.profile_image_path ?? null,
      points,
      streak: up?.currentStreak ?? 0,
      accuracy: Number(up?.accuracyPercent ?? 0),
    };
  }

  /**
   * Backfill RECORDING_CREATE events for court sessions that never received XP.
   * Idempotent — safe to run multiple times.
   */
  async backfillRecordingPoints(dryRun = false): Promise<{
    awarded: number;
    skipped: number;
    dryRun: boolean;
  }> {
    const sessions = await this.dataSource.query(`
      SELECT DISTINCT ON (r."userId", r."cameraId", r."startTime", r."endTime")
        r.id,
        r."userId",
        r."cameraId",
        r."startTime",
        r."endTime"
      FROM recordings r
      WHERE r."userId" IS NOT NULL
        AND r.status IN ('ready', 'completed', 'in_progress', 'extracting')
      ORDER BY r."userId", r."cameraId", r."startTime", r."endTime", r.id ASC
    `);

    let awarded = 0;
    let skipped = 0;

    for (const row of sessions) {
      const userId = String(row.userId);
      const refId = `${row.cameraId}_${new Date(row.startTime).toISOString()}_${new Date(row.endTime).toISOString()}`;
      const key = this.buildIdempotencyKey(
        PointEventType.RECORDING_CREATE,
        userId,
        refId,
      );

      const existing = await this.eventRepo.findOne({
        where: { idempotencyKey: key },
        select: ['id'],
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        awarded += 1;
        continue;
      }

      const event = await this.awardPoints({
        userId,
        eventType: PointEventType.RECORDING_CREATE,
        refId,
        metadata: { recordingId: row.id, source: 'backfill' },
      });
      if (event) awarded += 1;
      else skipped += 1;
    }

    if (!dryRun) {
      await this.dataSource.query(`
        UPDATE user_points up
        SET "totalPoints" = sub.total
        FROM (
          SELECT "userId", COALESCE(SUM(points), 0)::int AS total
          FROM point_events
          GROUP BY "userId"
        ) sub
        WHERE up."userId" = sub."userId"
          AND up."totalPoints" <> sub.total
      `);
      await this.dataSource.query(`
        INSERT INTO user_points ("userId", "totalPoints")
        SELECT pe."userId", COALESCE(SUM(pe.points), 0)::int
        FROM point_events pe
        WHERE NOT EXISTS (
          SELECT 1 FROM user_points up WHERE up."userId" = pe."userId"
        )
        GROUP BY pe."userId"
      `);
    }

    this.logger.log(
      `Backfill recording points: awarded=${awarded}, skipped=${skipped}, dryRun=${dryRun}`,
    );

    return { awarded, skipped, dryRun };
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

  async calculateLevel(points: number): Promise<{
    level: number;
    levelName: string | null;
    nextLevelPoints: number | null;
    levelProgress: number;
  }> {
    const configs = await this.levelConfigRepo.find({
      order: { minPoints: 'ASC' },
    });
    if (configs.length === 0) {
      return {
        level: 1,
        levelName: 'Bronze',
        nextLevelPoints: 10,
        levelProgress: Math.min(1, points / 10),
      };
    }
    let currentConfig = configs[0];
    let nextConfig = null;
    for (let i = 0; i < configs.length; i++) {
      if (points >= configs[i].minPoints) {
        currentConfig = configs[i];
        nextConfig = configs[i + 1] || null;
      } else {
        break;
      }
    }
    let progress = 0;
    if (nextConfig) {
      const range = nextConfig.minPoints - currentConfig.minPoints;
      if (range > 0) {
        progress = (points - currentConfig.minPoints) / range;
      }
    } else {
      progress = 1.0;
    }
    return {
      level: currentConfig.level,
      levelName: currentConfig.name || `Level ${currentConfig.level}`,
      nextLevelPoints: nextConfig ? nextConfig.minPoints : null,
      levelProgress: Math.min(1.0, Math.max(0.0, progress)),
    };
  }

  async listLevels(): Promise<LevelConfig[]> {
    return this.levelConfigRepo.find({ order: { level: 'ASC' } });
  }

  async createOrUpdateLevel(
    level: number,
    minPoints: number,
    name?: string,
  ): Promise<LevelConfig> {
    let row = await this.levelConfigRepo.findOne({ where: { level } });
    if (!row) {
      row = this.levelConfigRepo.create({ level });
    }
    row.minPoints = minPoints;
    if (name !== undefined) row.name = name.trim();
    return this.levelConfigRepo.save(row);
  }

  async deleteLevel(level: number): Promise<void> {
    await this.levelConfigRepo.delete({ level });
  }

  /**
   * Update user's streak based on activity date.
   * Call this whenever a user completes a recording/session.
   */
  async updateStreak(userId: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    let userPoints = await this.userPointsRepo.findOne({ where: { userId } });
    if (!userPoints) {
      userPoints = this.userPointsRepo.create({
        userId,
        totalPoints: 0,
        currentStreak: 1,
        longestStreak: 1,
        lastActivityDate: new Date(today),
        totalSessions: 0,
        successfulSessions: 0,
        accuracyPercent: 0,
      });
      await this.userPointsRepo.save(userPoints);
      return;
    }

    const lastActivity = userPoints.lastActivityDate
      ? new Date(userPoints.lastActivityDate).toISOString().split('T')[0]
      : null;

    if (lastActivity === today) {
      // Already counted today — no change
      return;
    }

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    if (lastActivity === yesterday) {
      // Consecutive day — increment streak
      userPoints.currentStreak += 1;
      if (userPoints.currentStreak > userPoints.longestStreak) {
        userPoints.longestStreak = userPoints.currentStreak;
      }
    } else {
      // Streak broken — reset to 1
      userPoints.currentStreak = 1;
    }

    userPoints.lastActivityDate = new Date(today);
    await this.userPointsRepo.save(userPoints);
  }

  /**
   * Update session stats for accuracy calculation.
   * Call this when a recording is completed.
   *
   * @param userId - User ID
   * @param wasSuccessful - Whether the session was successful (e.g., no errors, proper completion)
   */
  async updateSessionStats(
    userId: string,
    wasSuccessful: boolean,
  ): Promise<void> {
    let userPoints = await this.userPointsRepo.findOne({ where: { userId } });
    if (!userPoints) {
      userPoints = this.userPointsRepo.create({
        userId,
        totalPoints: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null,
        totalSessions: 1,
        successfulSessions: wasSuccessful ? 1 : 0,
        accuracyPercent: wasSuccessful ? 100 : 0,
      });
      await this.userPointsRepo.save(userPoints);
      return;
    }

    userPoints.totalSessions += 1;
    if (wasSuccessful) {
      userPoints.successfulSessions += 1;
    }

    // Calculate accuracy percentage
    userPoints.accuracyPercent =
      userPoints.totalSessions > 0
        ? (userPoints.successfulSessions / userPoints.totalSessions) * 100
        : 0;

    await this.userPointsRepo.save(userPoints);
  }

  /**
   * Get user's streak and accuracy stats
   */
  async getStreakAndAccuracy(userId: string): Promise<{
    currentStreak: number;
    longestStreak: number;
    accuracy: number;
    totalSessions: number;
  }> {
    const userPoints = await this.userPointsRepo.findOne({ where: { userId } });
    if (!userPoints) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        accuracy: 0,
        totalSessions: 0,
      };
    }

    return {
      currentStreak: userPoints.currentStreak,
      longestStreak: userPoints.longestStreak,
      accuracy: Number(userPoints.accuracyPercent),
      totalSessions: userPoints.totalSessions,
    };
  }
}
