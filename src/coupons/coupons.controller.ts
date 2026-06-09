import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminRoleService } from 'src/admin/admin-role.service';
import { ILocalLoginPayload } from 'src/auth/strategy/jwt.strategy';
import { UserService } from 'src/user/user.service';
import { CouponsService } from './coupons.service';
import {
  AssignCouponDto,
  CreateCouponDto,
  PreviewCouponDto,
  UpdateCouponDto,
  UpsertAutoRuleDto,
} from './dto/coupon.dto';

@ApiTags('coupons')
@ApiBearerAuth('access-token')
@Controller('coupons')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CouponsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly adminRole: AdminRoleService,
    private readonly userService: UserService,
  ) {}

  // ─── User routes ────────────────────────────────────────────────────────

  /** Coupons the authenticated user can use right now. */
  @Get('me')
  @ApiOperation({ summary: 'List active coupons for the authenticated user' })
  myCoupons(@Req() req: Request & { user: ILocalLoginPayload }) {
    return this.coupons.listActiveForUser(req.user.user_id);
  }

  /**
   * Discount preview. Caller passes a base price; we return the discounted
   * total + assignment id. No side effects; safe to spam-call as the user
   * types.
   */
  @Post('me/preview')
  @ApiOperation({ summary: 'Preview the discount a code would apply' })
  preview(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() body: PreviewCouponDto,
  ) {
    return this.coupons.previewDiscount(
      req.user.user_id,
      body.code,
      body.basePriceInr,
    );
  }

  // ─── Admin routes ───────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Admin: list all coupons' })
  async list(@Req() req: Request & { user: ILocalLoginPayload }) {
    await this.assertAdmin(req.user.user_id);
    return this.coupons.listCoupons();
  }

  @Post()
  @ApiOperation({ summary: 'Admin: create a coupon' })
  async create(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() body: CreateCouponDto,
  ) {
    await this.assertAdmin(req.user.user_id);
    return this.coupons.createCoupon(req.user.user_id, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Admin: update a coupon' })
  async update(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCouponDto,
  ) {
    await this.assertAdmin(req.user.user_id);
    return this.coupons.updateCoupon(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Admin: delete a coupon' })
  async remove(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.assertAdmin(req.user.user_id);
    await this.coupons.deleteCoupon(id);
    return { ok: true };
  }

  /** Manual assign-to-user (admin clicks "Grant"). */
  @Post(':id/assign')
  @ApiOperation({ summary: 'Admin: grant a coupon to a user' })
  async assign(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) couponId: string,
    @Body() body: AssignCouponDto,
  ) {
    await this.assertAdmin(req.user.user_id);
    return this.coupons.assignCouponToUser({
      couponId,
      userId: body.userId,
      source: 'manual',
      note: body.note ?? null,
    });
  }

  @Delete('assignments/:assignmentId')
  @ApiOperation({ summary: 'Admin: revoke an assignment' })
  async revokeAssignment(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    await this.assertAdmin(req.user.user_id);
    await this.coupons.revokeAssignment(assignmentId);
    return { ok: true };
  }

  @Get('assignments/list')
  @ApiOperation({ summary: 'Admin: list assignments (optionally filtered)' })
  async listAssignments(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Query('couponId') couponId?: string,
    @Query('userId') userId?: string,
  ) {
    await this.assertAdmin(req.user.user_id);
    return this.coupons.listAssignments({ couponId, userId });
  }

  @Get('redemptions/list')
  @ApiOperation({ summary: 'Admin: recent redemptions' })
  async listRedemptions(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Query('limit') limit?: string,
  ) {
    await this.assertAdmin(req.user.user_id);
    return this.coupons.listRedemptions(limit ? Number(limit) : 50);
  }

  // ─── Auto-rules ─────────────────────────────────────────────────────────

  @Get('auto-rules/list')
  @ApiOperation({ summary: 'Admin: list leaderboard auto-assign rules' })
  async listAutoRules(@Req() req: Request & { user: ILocalLoginPayload }) {
    await this.assertAdmin(req.user.user_id);
    return this.coupons.listAutoRules();
  }

  @Post('auto-rules')
  @ApiOperation({ summary: 'Admin: upsert a leaderboard auto-assign rule' })
  async upsertAutoRule(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() body: UpsertAutoRuleDto,
  ) {
    await this.assertAdmin(req.user.user_id);
    return this.coupons.upsertAutoRule(body);
  }

  @Delete('auto-rules/:id')
  @ApiOperation({ summary: 'Admin: delete a leaderboard auto-assign rule' })
  async deleteAutoRule(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.assertAdmin(req.user.user_id);
    await this.coupons.deleteAutoRule(id);
    return { ok: true };
  }

  private async assertAdmin(userId: string): Promise<void> {
    const u = await this.userService.findOne(userId);
    if (!(await this.adminRole.isAdminByPhone(u.phone_number))) {
      throw new ForbiddenException('Admin only');
    }
  }
}
