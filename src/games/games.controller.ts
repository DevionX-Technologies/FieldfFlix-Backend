import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GamesService } from './games.service';
import { CreateGameDto } from './dto/create-game.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { ExtractMatchDto } from './dto/extract-match.dto';
import { GameEntity } from './entities/game.entity';
import { Public } from 'src/decorators/public.decorator';

/**
 * GamesController
 *
 * Routes under /games
 *
 * Provides:
 * 1. CRUD for tournament games/matches
 * 2. On-demand match video extraction from venue NVR/cameras
 * 3. Dual-path playback:
 *    - Direct R2 playback (available immediately upon R2 upload)
 *    - Cloudflare Stream VOD adaptive HLS playback
 * 4. Direct video download without requiring stream playback
 */
@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  // ─── Create ────────────────────────────────────────────────────────────────

  /**
   * POST /games
   * Create a new game entry for a tournament.
   */
  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a new game/match in a tournament' })
  async create(
    @Body() dto: CreateGameDto,
    @Request() req: { user?: { sub?: string; user_id?: string } },
  ): Promise<GameEntity> {
    const userId = req.user?.user_id || req.user?.sub;
    return this.gamesService.create(dto, userId);
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  /**
   * GET /games?tournamentId=&status=&courtNumber=
   * List games for a tournament. Public.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'List games for a tournament' })
  async findByTournament(
    @Query('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Query('status') status?: string,
    @Query('courtNumber') courtNumber?: string,
  ): Promise<GameEntity[]> {
    return this.gamesService.findByTournament(tournamentId, {
      status,
      courtNumber: courtNumber ? Number(courtNumber) : undefined,
    });
  }

  /**
   * GET /games/:id
   * Get a single game. Public.
   */
  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get game details by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<GameEntity> {
    return this.gamesService.findOne(id);
  }

  // ─── Dual-Path Playback & Download ─────────────────────────────────────────

  /**
   * GET /games/:id/playback
   * Returns dual-path playback URLs:
   * - direct_playback_url: Presigned GET to R2 (playable immediately without waiting for stream)
   * - stream_playback_url: Cloudflare Stream adaptive HLS manifest (when ready)
   * - download_url: Direct download URL from R2
   */
  @Public()
  @Get(':id/playback')
  @ApiOperation({
    summary:
      'Get dual playback URLs for game: immediate R2 direct playback + Cloudflare Stream VOD HLS',
  })
  async getPlayback(@Param('id', ParseUUIDPipe) id: string) {
    return this.gamesService.getPlayback(id);
  }

  /**
   * GET /games/:id/download
   * Direct download of original game match video from R2.
   */
  @Public()
  @Get(':id/download')
  @ApiOperation({
    summary: 'Get direct download URL for game match video from R2',
  })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('redirect') redirect: string,
    @Res() res: Response,
  ) {
    const data = await this.gamesService.getDownloadUrl(id);
    if (redirect === 'true' || redirect === '1') {
      return res.redirect(HttpStatus.FOUND, data.downloadUrl);
    }
    return res.status(HttpStatus.OK).json(data);
  }

  // ─── Match Extraction ──────────────────────────────────────────────────────

  /**
   * POST /games/:id/extract-match
   * Trigger on-demand match video extraction for this game from venue NVR.
   */
  @Post(':id/extract-match')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Extract match video from venue NVR for this game' })
  async extractMatchForGame(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<ExtractMatchDto>,
    @Request() req: { user?: { sub?: string; user_id?: string } },
  ) {
    const userId = req.user?.user_id || req.user?.sub;
    return this.gamesService.extractMatch(id, dto, userId);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  /**
   * PATCH /games/:id
   * Partial update — score, status, metadata, etc.
   */
  @Patch(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update game details' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGameDto,
  ): Promise<GameEntity> {
    return this.gamesService.update(id, dto);
  }

  /**
   * PATCH /games/:id/link-recording/:recordingId
   * Link a recording to a game.
   */
  @Patch(':id/link-recording/:recordingId')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Link a recording ID to this game' })
  async linkRecording(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordingId', ParseUUIDPipe) recordingId: string,
  ): Promise<GameEntity> {
    return this.gamesService.linkRecording(id, recordingId);
  }

  /**
   * PATCH /games/:id/live
   * Mark a game as live.
   */
  @Patch(':id/live')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Mark game as live' })
  async markLive(@Param('id', ParseUUIDPipe) id: string): Promise<GameEntity> {
    return this.gamesService.markLive(id);
  }

  /**
   * PATCH /games/:id/complete
   * Mark a game as completed.
   */
  @Patch(':id/complete')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Mark game as completed' })
  async markCompleted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('score') score?: string,
  ): Promise<GameEntity> {
    return this.gamesService.markCompleted(id, score);
  }

  /**
   * PATCH /games/:id/cancel
   * Cancel a game.
   */
  @Patch(':id/cancel')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Mark game as cancelled' })
  async markCancelled(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GameEntity> {
    return this.gamesService.markCancelled(id);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  /**
   * DELETE /games/:id
   * Remove a game entry.
   */
  @Delete(':id')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a game' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.gamesService.remove(id);
  }
}
