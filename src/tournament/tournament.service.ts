import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TournamentEntity,
  TournamentStatus,
} from './entities/tournament.entity';

@Injectable()
export class TournamentService {
  private readonly logger = new Logger(TournamentService.name);

  constructor(
    @InjectRepository(TournamentEntity)
    private readonly tournamentRepo: Repository<TournamentEntity>,
  ) {}

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
