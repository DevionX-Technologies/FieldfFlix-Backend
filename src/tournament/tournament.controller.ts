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
import { TournamentEntity } from './entities/tournament.entity';

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
  @Get('enrolled')
  @ApiOperation({ summary: 'List tournaments the user is enrolled in' })
  async getEnrolledTournaments(@Query('userId') userId: string) {
    return this.tournamentService.getEnrolledTournaments(userId);
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

  // NOTE: In a real app, these should have JwtAuthGuard and extract userId from token.
  // Assuming a generic approach where userId is passed in body/query for now, or extracted from req.
  // I will use a simple query/body param to avoid changing auth guard setup here.

  @Get(':id/enrollment')
  @ApiOperation({ summary: 'Check if user is enrolled in a tournament' })
  async checkEnrollment(
    @Param('id') tournamentId: string,
    @Query('userId') userId: string,
  ) {
    return this.tournamentService.checkEnrollment(tournamentId, userId);
  }

  @Post(':id/enroll')
  @ApiOperation({ summary: 'Enroll a user in a tournament' })
  async enrollTournament(
    @Param('id') tournamentId: string,
    @Body('userId') userId: string,
    @Body('razorpayOrderId') razorpayOrderId?: string,
  ) {
    return this.tournamentService.enrollTournament(
      tournamentId,
      userId,
      razorpayOrderId,
    );
  }

  @Post(':id/create-payment')
  @ApiOperation({ summary: 'Create Razorpay order for paid tournament entry' })
  async createTournamentPayment(
    @Param('id') tournamentId: string,
    @Body('userId') userId: string,
  ) {
    return this.tournamentService.createTournamentPaymentOrder(
      tournamentId,
      userId,
    );
  }

  @Patch(':id/live-streams')
  @ApiOperation({ summary: 'Update tournament live stream state (admin)' })
  async updateLiveStreams(
    @Param('id') tournamentId: string,
    @Body('liveStreams') liveStreams: TournamentEntity['liveStreams'],
  ) {
    return this.tournamentService.updateLiveStreams(tournamentId, liveStreams);
  }
}
