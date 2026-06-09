import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ILocalLoginPayload } from 'src/auth/strategy/jwt.strategy';
import { AdminRoleService } from 'src/admin/admin-role.service';
import { UserService } from 'src/user/user.service';
import { PointEventType } from './entities/point-event.entity';
import { PointsService } from './points.service';
import { UpdatePointConfigDto } from './dto/update-config.dto';

@ApiTags('points')
@ApiBearerAuth('access-token')
@Controller('points')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PointsController {
  constructor(
    private readonly points: PointsService,
    private readonly adminRole: AdminRoleService,
    private readonly userService: UserService,
  ) {}

  /** Current user's total + per-event breakdown. */
  @Get('me')
  @ApiOperation({ summary: 'Authenticated user point totals + breakdown' })
  async getMyPoints(@Req() req: Request & { user: ILocalLoginPayload }) {
    return this.points.getMyTotals(req.user.user_id);
  }

  /** Recent point-award timeline for the authenticated user. */
  @Get('me/events')
  @ApiOperation({ summary: 'Recent point-award timeline (newest first)' })
  async getMyEvents(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Query('limit') limitRaw?: string,
  ) {
    const limit = limitRaw ? Number(limitRaw) : 30;
    const rows = await this.points.getMyRecentEvents(req.user.user_id, limit);
    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      points: r.points,
      refId: r.refId,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Leaderboard for the current user-facing screen. Public to any authenticated
   * user — anyone can see who's at the top. `period` defaults to weekly.
   */
  @Get('leaderboard')
  @ApiOperation({
    summary: 'Leaderboard for a period (weekly / monthly / all)',
  })
  async getLeaderboard(
    @Query('period') periodRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const period =
      periodRaw === 'monthly' || periodRaw === 'all' ? periodRaw : 'weekly';
    const limit = limitRaw ? Number(limitRaw) : 50;
    return this.points.getLeaderboard(period, limit);
  }

  /** Admin: list all point configs. */
  @Get('configs')
  @ApiOperation({ summary: 'Admin: list all point configs' })
  async listConfigs(@Req() req: Request & { user: ILocalLoginPayload }) {
    await this.assertAdmin(req.user.user_id);
    return this.points.listConfigs();
  }

  /** Admin: update one point config (label / points / enabled). */
  @Patch('configs/:eventType')
  @ApiOperation({ summary: 'Admin: update a single point config' })
  async updateConfig(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('eventType') eventType: string,
    @Body() body: UpdatePointConfigDto,
  ) {
    await this.assertAdmin(req.user.user_id);
    const type = eventType as PointEventType;
    if (!Object.values(PointEventType).includes(type)) {
      throw new ForbiddenException('Unknown event type');
    }
    const updated = await this.points.updateConfig(type, body);
    return {
      eventType: updated.eventType,
      label: updated.label,
      points: updated.points,
      enabled: updated.enabled,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private async assertAdmin(userId: string): Promise<void> {
    const u = await this.userService.findOne(userId);
    if (!(await this.adminRole.isAdminByPhone(u.phone_number))) {
      throw new ForbiddenException('Admin only');
    }
  }
}
