import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('home/dashboard')
  @ApiOperation({ summary: 'Get home dashboard aggregated data' })
  getHomeDashboard(@Req() req: Request) {
    const user = req.user as any;
    const userId = user?.user_id || user?.id || user?.sub;
    return this.dashboardService.getHomeDashboard(userId);
  }

  @Get('analytics/me')
  @ApiOperation({ summary: 'Get user analytics data' })
  getAnalytics(@Req() req: Request) {
    const user = req.user as any;
    const userId = user?.user_id || user?.id || user?.sub;
    return this.dashboardService.getAnalytics(userId);
  }
}
