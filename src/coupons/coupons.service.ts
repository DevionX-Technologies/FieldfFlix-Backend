import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { Coupon } from './entities/coupon.entity';
import { CouponAssignment } from './entities/coupon-assignment.entity';
import { CouponRedemption } from './entities/coupon-redemption.entity';
import { LeaderboardAutoRule } from './entities/leaderboard-auto-rule.entity';

/**
 * Discount layer for recording unlocks.
 *
 * Design choices:
 *   - Coupon **codes** are stored UPPERCASE and uniqueness is enforced at the
 *     DB layer. We compare incoming codes case-insensitively at the edge.
 *   - We never modify the assignment row from inside `previewDiscount` — only
 *     `redeem` does the decrement, and only when called from inside the
 *     payment confirmation path. That keeps the preview side-effect-free.
 *   - `redeem` is idempotent per `paymentId` via the unique index on
 *     `CouponRedemption.paymentId`. Re-issuing the same redeem call returns
 *     the existing row without double-decrementing.
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
    @InjectRepository(CouponAssignment)
    private readonly assignmentRepo: Repository<CouponAssignment>,
    @InjectRepository(CouponRedemption)
    private readonly redemptionRepo: Repository<CouponRedemption>,
    @InjectRepository(LeaderboardAutoRule)
    private readonly ruleRepo: Repository<LeaderboardAutoRule>,
  ) {}

  private normalizeCode(raw: string): string {
    return String(raw ?? '')
      .trim()
      .toUpperCase();
  }

  // ─── Admin: CRUD ────────────────────────────────────────────────────────

  async listCoupons(): Promise<Coupon[]> {
    return this.couponRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getCoupon(id: string): Promise<Coupon> {
    const row = await this.couponRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }

  async createCoupon(
    createdByUserId: string,
    body: {
      code: string;
      label: string;
      discountPercent: number;
      maxRecordings: number;
      startsAt?: string | null;
      expiresAt?: string | null;
      enabled?: boolean;
    },
  ): Promise<Coupon> {
    const code = this.normalizeCode(body.code);
    if (!code) throw new BadRequestException('Code is required');
    if (
      !Number.isInteger(body.discountPercent) ||
      body.discountPercent < 1 ||
      body.discountPercent > 100
    ) {
      throw new BadRequestException('discountPercent must be 1–100');
    }
    if (!Number.isInteger(body.maxRecordings) || body.maxRecordings < 1) {
      throw new BadRequestException('maxRecordings must be >= 1');
    }

    const existing = await this.couponRepo.findOne({ where: { code } });
    if (existing) {
      throw new BadRequestException('A coupon with this code already exists');
    }
    const row = this.couponRepo.create({
      code,
      label: String(body.label ?? '').trim() || code,
      discountPercent: body.discountPercent,
      maxRecordings: body.maxRecordings,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      enabled: body.enabled ?? true,
      createdByUserId: createdByUserId ?? null,
    });
    return this.couponRepo.save(row);
  }

  async updateCoupon(
    id: string,
    patch: Partial<{
      label: string;
      discountPercent: number;
      maxRecordings: number;
      startsAt: string | null;
      expiresAt: string | null;
      enabled: boolean;
    }>,
  ): Promise<Coupon> {
    const row = await this.getCoupon(id);
    if (patch.label != null)
      row.label = String(patch.label).trim() || row.label;
    if (patch.discountPercent != null) {
      if (
        !Number.isInteger(patch.discountPercent) ||
        patch.discountPercent < 1 ||
        patch.discountPercent > 100
      ) {
        throw new BadRequestException('discountPercent must be 1–100');
      }
      row.discountPercent = patch.discountPercent;
    }
    if (patch.maxRecordings != null) {
      if (!Number.isInteger(patch.maxRecordings) || patch.maxRecordings < 1) {
        throw new BadRequestException('maxRecordings must be >= 1');
      }
      row.maxRecordings = patch.maxRecordings;
    }
    if (patch.startsAt !== undefined) {
      row.startsAt = patch.startsAt ? new Date(patch.startsAt) : null;
    }
    if (patch.expiresAt !== undefined) {
      row.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
    }
    if (patch.enabled != null) row.enabled = patch.enabled;
    return this.couponRepo.save(row);
  }

  async deleteCoupon(id: string): Promise<void> {
    const res = await this.couponRepo.delete(id);
    if (!res.affected) throw new NotFoundException();
  }

  // ─── Assignments ────────────────────────────────────────────────────────

  async listAssignments(filter: {
    couponId?: string;
    userId?: string;
  }): Promise<CouponAssignment[]> {
    return this.assignmentRepo.find({
      where: {
        ...(filter.couponId ? { couponId: filter.couponId } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
      },
      order: { createdAt: 'DESC' },
      relations: ['coupon', 'user'],
    });
  }

  async assignCouponToUser(args: {
    couponId: string;
    userId: string;
    source?: 'manual' | 'auto_leaderboard';
    note?: string | null;
  }): Promise<CouponAssignment> {
    const coupon = await this.getCoupon(args.couponId);
    if (!coupon.enabled) throw new BadRequestException('Coupon is disabled');
    const existing = await this.assignmentRepo.findOne({
      where: { couponId: args.couponId, userId: args.userId },
    });
    if (existing) {
      // Idempotent — silently return the existing assignment. Admins
      // expect "grant" to be safe to spam-click.
      return existing;
    }
    const row = this.assignmentRepo.create({
      couponId: args.couponId,
      userId: args.userId,
      source: args.source ?? 'manual',
      remainingRecordings: coupon.maxRecordings,
      note: args.note ?? null,
    });
    return this.assignmentRepo.save(row);
  }

  async revokeAssignment(assignmentId: string): Promise<void> {
    const res = await this.assignmentRepo.delete(assignmentId);
    if (!res.affected) throw new NotFoundException();
  }

  // ─── User-facing ────────────────────────────────────────────────────────

  /**
   * Active coupons currently usable by `userId`.
   *
   * "Usable" = assignment row exists with `remainingRecordings > 0` AND the
   * underlying coupon is enabled AND inside its validity window AND has
   * remaining redemptions.
   */
  async listActiveForUser(userId: string): Promise<
    Array<{
      assignmentId: string;
      couponId: string;
      code: string;
      label: string;
      discountPercent: number;
      remainingRecordings: number;
      startsAt: string | null;
      expiresAt: string | null;
      source: string;
    }>
  > {
    const now = new Date();
    const rows = await this.assignmentRepo.find({
      where: { userId, remainingRecordings: MoreThan(0) },
      relations: ['coupon'],
      order: { createdAt: 'DESC' },
    });
    return rows
      .filter((r) => {
        const c = r.coupon;
        if (!c?.enabled) return false;
        if (c.startsAt && c.startsAt > now) return false;
        if (c.expiresAt && c.expiresAt <= now) return false;
        return true;
      })
      .map((r) => ({
        assignmentId: r.id,
        couponId: r.couponId,
        code: r.coupon.code,
        label: r.coupon.label,
        discountPercent: r.coupon.discountPercent,
        remainingRecordings: r.remainingRecordings,
        startsAt: r.coupon.startsAt ? r.coupon.startsAt.toISOString() : null,
        expiresAt: r.coupon.expiresAt ? r.coupon.expiresAt.toISOString() : null,
        source: r.source,
      }));
  }

  /**
   * Compute the discounted price for `basePriceInr` when `code` is applied
   * by `userId`. Side-effect-free — does NOT consume the assignment.
   *
   * Returns `null` when:
   *   - the code doesn't exist,
   *   - the user has no active assignment for this code,
   *   - the coupon is disabled or outside its validity window.
   *
   * The caller (payment service) calls `redeem` to actually consume the
   * assignment inside the payment confirmation transaction.
   */
  async previewDiscount(
    userId: string,
    code: string,
    basePriceInr: number,
  ): Promise<{
    couponId: string;
    assignmentId: string;
    code: string;
    label: string;
    discountPercent: number;
    discountedPriceInr: number;
  } | null> {
    const normalized = this.normalizeCode(code);
    if (!normalized) return null;
    const coupon = await this.couponRepo.findOne({
      where: { code: normalized },
    });
    if (!coupon || !coupon.enabled) return null;

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) return null;
    if (coupon.expiresAt && coupon.expiresAt <= now) return null;

    const assignment = await this.assignmentRepo.findOne({
      where: {
        couponId: coupon.id,
        userId,
        remainingRecordings: MoreThan(0),
      },
    });
    if (!assignment) return null;

    const discountedPriceInr = Math.max(
      0,
      Math.round(basePriceInr * (1 - coupon.discountPercent / 100)),
    );

    return {
      couponId: coupon.id,
      assignmentId: assignment.id,
      code: coupon.code,
      label: coupon.label,
      discountPercent: coupon.discountPercent,
      discountedPriceInr,
    };
  }

  /**
   * Atomically consume one redemption of `assignmentId` for `paymentId`.
   *
   * Decrements `remainingRecordings` (if > 0) and inserts a
   * `CouponRedemption` row, all inside one transaction. Returns the row on
   * success, null on no-op (already redeemed for this payment, or no
   * remaining redemptions on the assignment).
   *
   * Safe to retry: the unique index on `paymentId` collapses duplicates.
   */
  async redeem(args: {
    userId: string;
    assignmentId: string;
    paymentId: string;
    recordingId: string | null;
    basePriceInr: number;
  }): Promise<CouponRedemption | null> {
    return this.dataSource.transaction(async (manager) => {
      // Idempotency short-circuit.
      const existing = await manager.getRepository(CouponRedemption).findOne({
        where: { paymentId: args.paymentId },
      });
      if (existing) return existing;

      const assignment = await manager.getRepository(CouponAssignment).findOne({
        where: { id: args.assignmentId, userId: args.userId },
        relations: ['coupon'],
        // Lock so a concurrent redeem can't double-spend the last slot.
        lock: { mode: 'pessimistic_write' },
      });
      if (!assignment) return null;
      if (assignment.remainingRecordings <= 0) return null;
      const coupon = assignment.coupon;
      if (!coupon?.enabled) return null;
      const now = new Date();
      if (coupon.startsAt && coupon.startsAt > now) return null;
      if (coupon.expiresAt && coupon.expiresAt <= now) return null;

      const discountedPriceInr = Math.max(
        0,
        Math.round(args.basePriceInr * (1 - coupon.discountPercent / 100)),
      );

      assignment.remainingRecordings -= 1;
      await manager.getRepository(CouponAssignment).save(assignment);

      const redemption = manager.getRepository(CouponRedemption).create({
        couponId: coupon.id,
        assignmentId: assignment.id,
        userId: args.userId,
        paymentId: args.paymentId,
        recordingId: args.recordingId,
        basePriceInr: args.basePriceInr,
        discountedPriceInr,
        discountPercentApplied: coupon.discountPercent,
      });
      try {
        return await manager.getRepository(CouponRedemption).save(redemption);
      } catch (err: unknown) {
        // Race on the unique paymentId index — another concurrent redeem
        // beat us. Re-read and return that row.
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          String((err as { code: string }).code) === '23505'
        ) {
          return await manager
            .getRepository(CouponRedemption)
            .findOne({ where: { paymentId: args.paymentId } });
        }
        throw err;
      }
    });
  }

  // ─── Auto-assign rules ──────────────────────────────────────────────────

  async listAutoRules(): Promise<LeaderboardAutoRule[]> {
    return this.ruleRepo.find({
      order: { period: 'ASC', rank: 'ASC' },
    });
  }

  async upsertAutoRule(body: {
    period: 'weekly' | 'monthly';
    rank: number;
    couponId: string;
    enabled?: boolean;
  }): Promise<LeaderboardAutoRule> {
    if (!Number.isInteger(body.rank) || body.rank < 1) {
      throw new BadRequestException('rank must be a positive integer');
    }
    await this.getCoupon(body.couponId);
    const existing = await this.ruleRepo.findOne({
      where: { period: body.period, rank: body.rank },
    });
    if (existing) {
      existing.couponId = body.couponId;
      if (body.enabled != null) existing.enabled = body.enabled;
      return this.ruleRepo.save(existing);
    }
    const row = this.ruleRepo.create({
      period: body.period,
      rank: body.rank,
      couponId: body.couponId,
      enabled: body.enabled ?? true,
    });
    return this.ruleRepo.save(row);
  }

  async deleteAutoRule(id: string): Promise<void> {
    const res = await this.ruleRepo.delete(id);
    if (!res.affected) throw new NotFoundException();
  }

  /**
   * Recent redemptions for admin tracking — newest first.
   */
  async listRedemptions(limit = 50): Promise<CouponRedemption[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    return this.redemptionRepo.find({
      order: { createdAt: 'DESC' },
      take: safeLimit,
      relations: ['coupon', 'user'],
    });
  }
}
