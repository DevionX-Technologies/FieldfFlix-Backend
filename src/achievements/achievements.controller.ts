import {
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

@ApiTags('achievements')
@ApiBearerAuth('access-token')
@Controller(['achievements', 'api/v1/achievements'])
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AchievementsController {
  constructor(private readonly achievementsService: AchievementsService) {}

  /**
   * Task 17 & 18: Main unified achievement endpoint.
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
   * Task 19 & 20: Safe achievement reward claim endpoint.
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
    description: 'Achievement milestone requirements have not been met yet',
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
}
