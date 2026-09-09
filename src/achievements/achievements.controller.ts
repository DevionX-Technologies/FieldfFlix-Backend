import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ILocalLoginPayload } from 'src/auth/strategy/jwt.strategy';
import { AchievementsService } from './achievements.service';
import { AchievementQueryDto } from './dto/achievement-query.dto';
import {
  ClaimAchievementResponseDto,
  GetAchievementsResponseDto,
} from './dto/achievement-response.dto';
import {
  MatchEventResponseDto,
  RecordMatchEventDto,
} from './dto/match-event.dto';
import {
  GoalEventResponseDto,
  RecordGoalEventDto,
} from './dto/goal-event.dto';
import {
  MvpEventResponseDto,
  RecordMvpEventDto,
} from './dto/mvp-event.dto';
import {
  RecordStreakEventDto,
  StreakEventResponseDto,
} from './dto/streak-event.dto';
import {
  IngestMetricEventDto,
  IngestMetricResponseDto,
} from './dto/telemetry-event.dto';

@ApiTags('achievements')
@ApiBearerAuth('access-token')
@Controller(['achievements', 'api/v1/achievements'])
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AchievementsController {
  constructor(private readonly achievementsService: AchievementsService) {}

  /**
   * Main unified achievement endpoint.
   * Returns summary statistics, all achievement records with normalized progress,
   * tier, status, XP, and claim state.
   */
  @Get()
  @ApiOperation({
    summary: 'Get unified achievement list, progress, and summary statistics',
    description:
      'Fetches the complete achievement catalogue for the authenticated user, normalized with progress percentages, FSM states (LOCKED, IN_PROGRESS, UNLOCKED, CLAIMED), and aggregate gamification summary.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Achievement catalogue and summary statistics retrieved successfully',
    type: GetAchievementsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User is not authenticated (invalid or missing JWT token)',
  })
  async getAchievements(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Query() query: AchievementQueryDto,
  ): Promise<GetAchievementsResponseDto> {
    return this.achievementsService.getAchievements(req.user.user_id, query);
  }

  /**
   * Safe achievement reward claim endpoint.
   * Server-side completion validation, atomic state transition to CLAIMED,
   * idempotent reward crediting, and structured error responses.
   */
  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim XP reward for an earned / unlocked achievement',
    description:
      'Validates server-side that the achievement requirements have been satisfied, atomically credits XP reward points, updates player level progression, and prevents duplicate claims.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: 'ATH_TURF_DEBUT',
    description: 'Unique achievement ID to claim',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Achievement reward claimed successfully and XP credited',
    type: ClaimAchievementResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Achievement milestone requirements have not been met yet or achievement inactive',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User is not authenticated (invalid or missing JWT token)',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Achievement definition does not exist in the catalogue',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Achievement reward has already been claimed (idempotency guard)',
  })
  async claimReward(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id') achievementId: string,
  ): Promise<ClaimAchievementResponseDto> {
    return this.achievementsService.claimAchievementReward(
      req.user.user_id,
      achievementId,
    );
  }

  /**
   * Task 12: Integrate Match Events endpoint
   */
  @Post('events/match')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record match participation event for athlete achievements',
    description:
      'Increments matches played metric and evaluates athlete match-count milestones (Turf Debut, Regular Starter, Centurion).',
  })
  @ApiBody({ type: RecordMatchEventDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Match participation recorded and milestones evaluated',
    type: MatchEventResponseDto,
  })
  async recordMatchEvent(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() dto: RecordMatchEventDto,
  ): Promise<MatchEventResponseDto> {
    const targetUserId = dto.userId || req.user.user_id;
    const result = await this.achievementsService.recordMatchParticipation(
      targetUserId,
      dto.matchesCount || 1,
      {
        matchId: dto.matchId,
        sport: dto.sport,
        turfId: dto.turfId,
        isRecorded: true,
      },
    );

    return {
      success: true,
      userId: targetUserId,
      totalMatchesPlayed: result.totalMatchesPlayed,
      unlockedAchievements: result.unlockedAchievements,
    };
  }

  /**
   * Task 13: Integrate Goal Events endpoint
   */
  @Post('events/goal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record goal scoring event for offensive achievements',
    description:
      'Increments total goals scored and evaluates Sharp Shooter and Goal Machine milestones.',
  })
  @ApiBody({ type: RecordGoalEventDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Goals recorded and milestones evaluated',
    type: GoalEventResponseDto,
  })
  async recordGoalEvent(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() dto: RecordGoalEventDto,
  ): Promise<GoalEventResponseDto> {
    const targetUserId = dto.userId || req.user.user_id;
    const result = await this.achievementsService.recordGoalScored(
      targetUserId,
      dto.goalsCount || 1,
      {
        matchId: dto.matchId,
        highlightId: dto.highlightId,
      },
    );

    return {
      success: true,
      userId: targetUserId,
      totalGoalsScored: result.totalGoalsScored,
      unlockedAchievements: result.unlockedAchievements,
    };
  }

  /**
   * Task 14: Integrate MVP Events endpoint
   */
  @Post('events/mvp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record MVP award event for MVP and Turf Legend progression',
    description:
      'Increments MVP matches count and evaluates MVP (5) and Turf Legend (25) milestones.',
  })
  @ApiBody({ type: RecordMvpEventDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'MVP award recorded and milestones evaluated',
    type: MvpEventResponseDto,
  })
  async recordMvpEvent(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() dto: RecordMvpEventDto,
  ): Promise<MvpEventResponseDto> {
    const targetUserId = dto.userId || req.user.user_id;
    const result = await this.achievementsService.recordMvpAwarded(
      targetUserId,
      dto.count || 1,
      {
        matchId: dto.matchId,
        tournamentId: dto.tournamentId,
      },
    );

    return {
      success: true,
      userId: targetUserId,
      totalMvpMatchesCount: result.totalMvpMatchesCount,
      unlockedAchievements: result.unlockedAchievements,
    };
  }

  /**
   * Task 15: Integrate Match Streak Events endpoint
   */
  @Post('events/streak')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record streak updates for Consistent Player and Hot Streak',
    description:
      'Updates active streak days and match win streak, and evaluates streak-based milestones.',
  })
  @ApiBody({ type: RecordStreakEventDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Streaks updated and milestones evaluated',
    type: StreakEventResponseDto,
  })
  async recordStreakEvent(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() dto: RecordStreakEventDto,
  ): Promise<StreakEventResponseDto> {
    const targetUserId = dto.userId || req.user.user_id;
    const result = await this.achievementsService.recordStreakUpdated(
      targetUserId,
      dto.streakDays,
      dto.matchWinStreak,
    );

    return {
      success: true,
      userId: targetUserId,
      streakDays: result.streakDays,
      matchWinStreak: result.matchWinStreak,
      unlockedAchievements: result.unlockedAchievements,
    };
  }

  /**
   * Ingest Telemetry Metric (direct or via Redis buffer)
   */
  @Post('events/telemetry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ingest telemetry metric directly or via Redis buffer',
    description:
      'Ingests real-time telemetry counter or peak gauge with optional buffering.',
  })
  @ApiBody({ type: IngestMetricEventDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Telemetry metric ingested',
    type: IngestMetricResponseDto,
  })
  async ingestTelemetryMetric(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() dto: IngestMetricEventDto,
  ): Promise<IngestMetricResponseDto> {
    const targetUserId = dto.userId || req.user.user_id;
    const result = await this.achievementsService.aggregatorService.ingestMetric({
      userId: targetUserId,
      metricKey: dto.metricKey,
      incrementBy: dto.incrementBy,
      value: dto.value,
      flagValue: dto.flagValue,
    });

    return {
      success: true,
      userId: targetUserId,
      metricKey: dto.metricKey,
      currentMetricValue: result.currentMetricValue,
      unlockedAchievements: result.unlockedAchievements,
    };
  }

  /**
   * Task 9 & 10: Manual Buffer Flush Endpoint
   */
  @Post('buffer/flush')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Flush buffered Redis metrics immediately to database',
    description:
      'Drains the Redis metrics buffer and persists accumulated metric deltas to PostgreSQL.',
  })
  async flushBuffer() {
    const flushedDeltas = await this.achievementsService.flushMetricsBuffer();
    return {
      success: true,
      flushedUsersCount: flushedDeltas.length,
      stats: this.achievementsService.getBufferStats(),
    };
  }
}
