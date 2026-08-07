import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/decorators/public.decorator';
import { TournamentService } from './tournament.service';
import { TournamentStatus } from './entities/tournament.entity';

@ApiTags('tournaments')
@Controller('tournaments')
export class TournamentController {
  constructor(private readonly tournamentService: TournamentService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary:
      'List all public tournaments with optional sport and status filters',
  })
  async listTournaments(
    @Query('sport') sport?: string,
    @Query('status') status?: string,
  ) {
    return this.tournamentService.listTournaments({ sport, status });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get tournament details by ID' })
  async getTournamentDetails(@Param('id') id: string) {
    return this.tournamentService.getTournamentById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create or request a tournament' })
  async createTournament(@Body() body: any) {
    return this.tournamentService.createTournament(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update tournament info or status' })
  async updateTournament(@Param('id') id: string, @Body() body: any) {
    return this.tournamentService.updateTournament(id, body);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Approve, activate or update tournament status' })
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: TournamentStatus,
  ) {
    return this.tournamentService.setTournamentStatus(id, status);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete tournament' })
  async deleteTournament(@Param('id') id: string) {
    return this.tournamentService.deleteTournament(id);
  }
}
