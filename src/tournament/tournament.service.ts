import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TournamentEntity,
  TournamentStatus,
} from './entities/tournament.entity';

@Injectable()
export class TournamentService implements OnModuleInit {
  private readonly logger = new Logger(TournamentService.name);

  constructor(
    @InjectRepository(TournamentEntity)
    private readonly tournamentRepo: Repository<TournamentEntity>,
  ) {}

  async onModuleInit() {
    try {
      await this.tournamentRepo.query(`
        CREATE TABLE IF NOT EXISTS "tournaments" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "name" character varying(255) NOT NULL,
          "sport" character varying(100) NOT NULL DEFAULT 'Pickleball',
          "bannerImage" character varying(500),
          "prizePool" integer NOT NULL DEFAULT 0,
          "closingDate" TIMESTAMP,
          "venue" character varying(255) NOT NULL DEFAULT 'Venue Stadium',
          "city" character varying(100) NOT NULL DEFAULT 'Mumbai',
          "startDate" TIMESTAMP NOT NULL DEFAULT now(),
          "endDate" TIMESTAMP,
          "participantsCount" integer NOT NULL DEFAULT 0,
          "maxParticipants" integer NOT NULL DEFAULT 32,
          "entryFee" integer NOT NULL DEFAULT 0,
          "skillLevel" character varying(50) NOT NULL DEFAULT 'Open / Intermediate',
          "ageGroup" character varying(50) NOT NULL DEFAULT 'All Ages',
          "gender" character varying(50) NOT NULL DEFAULT 'Open',
          "isIndoor" boolean NOT NULL DEFAULT true,
          "status" character varying(50) NOT NULL DEFAULT 'Upcoming',
          "description" text,
          "organizer" jsonb,
          "prizes" jsonb,
          "fixtures" jsonb,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_tournaments_id" PRIMARY KEY ("id")
        );
      `);
      this.logger.log('Verified tournaments schema in PostgreSQL.');
    } catch (err: any) {
      this.logger.warn(
        `Could not verify tournaments table on startup: ${err.message}`,
      );
    }
  }

  async listTournaments(filters?: {
    sport?: string;
    status?: string;
  }): Promise<TournamentEntity[]> {
    const qb = this.tournamentRepo
      .createQueryBuilder('t')
      .orderBy('t.startDate', 'ASC');

    if (filters?.sport) {
      qb.andWhere('LOWER(t.sport) = LOWER(:sport)', { sport: filters.sport });
    }
    if (filters?.status) {
      qb.andWhere('t.status = :status', { status: filters.status });
    }

    return qb.getMany();
  }

  async getTournamentById(id: string): Promise<TournamentEntity> {
    const tournament = await this.tournamentRepo.findOne({ where: { id } });
    if (!tournament) {
      throw new NotFoundException(`Tournament with ID ${id} not found`);
    }
    return tournament;
  }

  async createTournament(
    dto: Partial<TournamentEntity>,
  ): Promise<TournamentEntity> {
    const tournament = this.tournamentRepo.create({
      ...dto,
      status: dto.status || 'Upcoming',
      participantsCount: dto.participantsCount || 0,
      maxParticipants: dto.maxParticipants || 32,
      entryFee: dto.entryFee || 0,
    });
    return this.tournamentRepo.save(tournament);
  }

  async updateTournament(
    id: string,
    dto: Partial<TournamentEntity>,
  ): Promise<TournamentEntity> {
    const tournament = await this.getTournamentById(id);
    Object.assign(tournament, dto);
    return this.tournamentRepo.save(tournament);
  }

  async setTournamentStatus(
    id: string,
    status: TournamentStatus,
  ): Promise<TournamentEntity> {
    const tournament = await this.getTournamentById(id);
    tournament.status = status;
    return this.tournamentRepo.save(tournament);
  }

  async deleteTournament(id: string): Promise<{ success: boolean }> {
    const res = await this.tournamentRepo.delete(id);
    return { success: (res.affected || 0) > 0 };
  }
}
