import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  forwardRef,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { ILocalLoginPayload } from 'src/auth/strategy/jwt.strategy';
import { RecordingService } from 'src/recording/service/recording.service';
import { UserService } from 'src/user/user.service';
import { AdminRoleService } from './admin-role.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AddAdminPhoneDto } from './dto/add-admin-phone.dto';
import { Query } from '@nestjs/common';
import { Public } from 'src/decorators/public.decorator';

import { PricingConfigService } from 'src/payment/pricing-config.service';

import { IsNumber, IsOptional } from 'class-validator';

export class UpdatePricingConfigDto {
  @IsOptional()
  @IsNumber()
  cricket_hourly_rate?: number;

  @IsOptional()
  @IsNumber()
  cricket_half_hourly_rate?: number;

  @IsOptional()
  @IsNumber()
  pickleball_hourly_rate?: number;

  @IsOptional()
  @IsNumber()
  pickleball_half_hourly_rate?: number;

  @IsOptional()
  @IsNumber()
  padel_hourly_rate?: number;

  @IsOptional()
  @IsNumber()
  padel_half_hourly_rate?: number;

  @IsOptional()
  @IsNumber()
  default_hourly_rate?: number;

  @IsOptional()
  @IsNumber()
  default_half_hourly_rate?: number;

  @IsOptional()
  @IsNumber()
  highlight_base_price?: number;

  @IsOptional()
  @IsNumber()
  shorts_base_price?: number;

  @IsOptional()
  @IsNumber()
  gst_rate?: number;
}

@Controller('admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AdminController {
  constructor(
    private readonly adminRole: AdminRoleService,
    private readonly adminAnalytics: AdminAnalyticsService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => RecordingService))
    private readonly recordingService: RecordingService,
    private readonly pricingConfigService: PricingConfigService,
  ) {}

  @Public()
  @Put('pricing/config')
  async updatePricingConfig(
    @Req() req: Request & { user?: ILocalLoginPayload },
    @Body() dto: UpdatePricingConfigDto,
  ) {
    if (req.user?.user_id) {
      await this.assertAdmin(req.user.user_id);
    }
    const config = await this.pricingConfigService.updateConfig(dto);
    return {
      success: true,
      data: config,
      message: 'Pricing configuration updated successfully',
    };
  }

  /** System-wide KPI overview & trends for charts */
  @Public()
  @Get('analytics/overview')
  async getOverview(@Req() req: Request & { user?: ILocalLoginPayload }) {
    if (req.user?.user_id) {
      await this.assertAdmin(req.user.user_id);
    }
    return this.adminAnalytics.getOverviewStats();
  }

  /** Athlete CRM search & paginated directory */
  @Public()
  @Get('users')
  async getUsers(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('search') search: string,
    @Req() req: Request & { user?: ILocalLoginPayload },
  ) {
    if (req.user?.user_id) {
      await this.assertAdmin(req.user.user_id);
    }
    return this.adminAnalytics.listUsers(
      search,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  /** Complete 360 profile for an athlete */
  @Public()
  @Get('users/:id')
  async getUserProfile(
    @Param('id') userId: string,
    @Req() req: Request & { user?: ILocalLoginPayload },
  ) {
    if (req.user?.user_id) {
      await this.assertAdmin(req.user.user_id);
    }
    return this.adminAnalytics.getUserUtilityProfile(userId);
  }

  /** Fleet camera status & court controls */
  @Public()
  @Get('fleet')
  async getFleet(@Req() req: Request & { user?: ILocalLoginPayload }) {
    if (req.user?.user_id) {
      await this.assertAdmin(req.user.user_id);
    }
    return this.adminAnalytics.getFleetStatus();
  }

  /** Update court device mapping */
  @Public()
  @Put('cameras/:id')
  async updateCameraMapping(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      court_number?: number;
      raspberryPiBaseUrl?: string;
      raspberryPiApiKey?: string;
      hidden_from_app?: boolean;
    },
    @Req() req: Request & { user?: ILocalLoginPayload },
  ) {
    if (req.user?.user_id) {
      await this.assertAdmin(req.user.user_id);
    }
    return this.adminAnalytics.updateCameraMapping(id, body);
  }

  /** Hide or show entire venue(s) in the athlete app (cascades to all courts). */
  @Public()
  @Put('venues/visibility')
  async setVenuesAppVisibility(
    @Body()
    body: { turfIds: string[]; hidden_from_app: boolean },
    @Req() req: Request & { user?: ILocalLoginPayload },
  ) {
    if (req.user?.user_id) {
      await this.assertAdmin(req.user.user_id);
    }
    return this.adminAnalytics.setVenuesAppVisibility(
      body.turfIds,
      body.hidden_from_app,
    );
  }

  /** Create/Add new court device mapping */
  @Public()
  @Post('cameras')
  async createCameraMapping(
    @Body()
    body: {
      turfId: string;
      name?: string;
      court_number?: number;
      raspberryPiBaseUrl?: string;
    },
    @Req() req: Request & { user?: ILocalLoginPayload },
  ) {
    if (req.user?.user_id) {
      await this.assertAdmin(req.user.user_id);
    }
    return this.adminAnalytics.createCameraMapping(body);
  }

  /** Test Raspberry Pi health & connectivity */
  @Public()
  @Post('cameras/test-connectivity')
  async testConnectivity(
    @Body() body: { url: string },
    @Req() req: Request & { user?: ILocalLoginPayload },
  ) {
    if (req.user?.user_id) {
      await this.assertAdmin(req.user.user_id);
    }
    return this.adminAnalytics.testPiConnectivity(body.url);
  }

  /** Any authenticated user: whether they have admin UI access. */
  @Get('me')
  async me(@Req() req: Request & { user: ILocalLoginPayload }) {
    const u = await this.userService.findOne(req.user.user_id);
    const isAdmin = await this.adminRole.isAdminByPhone(u.phone_number);
    return { isAdmin };
  }

  /**
   * Mux-ready recordings for the FlickShort admin picker (no manual UUID paste).
   */
  @Get('recordings-for-flickshorts')
  async recordingsForFlickshorts(
    @Req() req: Request & { user: ILocalLoginPayload },
  ) {
    await this.assertAdmin(req.user.user_id);
    return this.recordingService.listMuxReadyRecordingsForAdmin();
  }

  /**
   * Per-camera recording activity for the current day, grouped by status.
   *
   * Designed for incident triage when the operator sees a spike of "failed"
   * recordings and needs to know whether the failures are concentrated on
   * one Raspberry Pi or spread across the fleet. Response also surfaces the
   * most recent failed recording per camera with its raspberryPiRecordingId
   * so the operator can jump straight to the Pi’s logs.
   *
   *   GET /admin/cameras-today
   */
  @Get('cameras-today')
  async camerasToday(@Req() req: Request & { user: ILocalLoginPayload }) {
    await this.assertAdmin(req.user.user_id);
    return this.recordingService.cameraActivityToday();
  }

  @Get('phones')
  async listPhones(@Req() req: Request & { user: ILocalLoginPayload }) {
    await this.assertAdmin(req.user.user_id);
    const rows = await this.adminRole.listPhones();
    return {
      phones: rows.map((r) => ({
        id: r.id,
        phoneLast10: r.phoneLast10,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Post('phones')
  async addPhone(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() body: AddAdminPhoneDto,
  ) {
    const adminId = req.user.user_id;
    await this.assertAdmin(adminId);
    const created = await this.adminRole.addPhone(adminId, body.phone);
    return {
      id: created.id,
      phoneLast10: created.phoneLast10,
      createdAt: created.createdAt.toISOString(),
    };
  }

  @Delete('phones/:last10')
  async removePhone(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('last10') last10: string,
  ) {
    await this.assertAdmin(req.user.user_id);
    const d = String(last10).replace(/\D/g, '');
    const last = d.length >= 10 ? d.slice(-10) : d;
    if (last.length !== 10) {
      throw new NotFoundException();
    }
    await this.adminRole.removePhone(last);
    return { ok: true };
  }

  /** List recent recordings with playable video streams */
  @Public()
  @Get('recordings')
  async listRecordings(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
  ) {
    return this.adminAnalytics.listRecordings(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
      status,
    );
  }

  /** Date-wise on-demand extraction requests with live pipeline status */
  @Public()
  @Get('extraction-requests')
  async listExtractionRequests(
    @Query('date') date: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.adminAnalytics.listExtractionRequests(
      date || undefined,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 100,
    );
  }

  /** DB audit: recordings with S3 upload but no Mux playback yet */
  @Public()
  @Get('pipeline-storage-audit')
  async pipelineStorageAudit() {
    return this.adminAnalytics.getPipelineStorageAudit();
  }

  /** Trigger on-demand test match extraction from Dahua NVR */
  @Public()
  @Post('recordings/test-extract')
  async triggerTestExtraction(
    @Body()
    body: {
      cameraId: string;
      durationMinutes?: number;
      startTime?: string;
      endTime?: string;
    },
  ) {
    return this.adminAnalytics.triggerTestExtraction(
      this.recordingService,
      body,
    );
  }

  /** Get fresh playable stream URL for a recording */
  @Public()
  @Get('recordings/:id/playback-url')
  async getRecordingPlaybackUrl(@Param('id') id: string) {
    return this.adminAnalytics.getRecordingPlaybackUrl(id);
  }

  /** Broadcast Push Notifications */
  @Post('notifications/broadcast')
  async broadcastNotification(
    @Body()
    body: {
      title: string;
      body: string;
      targetAudience: string;
      specificNumber?: string;
      channels?: string[];
    },
    @Req() req: Request & { user: ILocalLoginPayload },
  ) {
    await this.assertAdmin(req.user.user_id);
    return this.adminAnalytics.broadcastNotification(
      body.title,
      body.body,
      body.targetAudience,
      body.specificNumber,
      body.channels,
    );
  }

  private async assertAdmin(userId: string): Promise<void> {
    const u = await this.userService.findOne(userId);
    if (!(await this.adminRole.isAdminByPhone(u.phone_number))) {
      throw new ForbiddenException('Admin only');
    }
  }
}
