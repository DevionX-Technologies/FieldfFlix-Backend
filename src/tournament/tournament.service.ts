import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TournamentEntity,
  TournamentStatus,
} from './entities/tournament.entity';
import { TournamentEnrollmentEntity } from './entities/tournament-enrollment.entity';

@Injectable()
export class TournamentService implements OnModuleInit {
  private readonly logger = new Logger(TournamentService.name);

  constructor(
    @InjectRepository(TournamentEntity)
    private readonly tournamentRepo: Repository<TournamentEntity>,
    @InjectRepository(TournamentEnrollmentEntity)
    private readonly enrollmentRepo: Repository<TournamentEnrollmentEntity>,
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
      
      await this.tournamentRepo.query(`
        CREATE TABLE IF NOT EXISTS "tournament_enrollments" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "tournamentId" uuid NOT NULL,
          "userId" uuid NOT NULL,
          "paymentId" character varying(255),
          "enrolledAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_tournament_enrollments_id" PRIMARY KEY ("id")
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

  async checkEnrollment(tournamentId: string, userId: string): Promise<{ isEnrolled: boolean }> {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { tournamentId, userId },
    });
    return { isEnrolled: !!enrollment };
  }

  async enrollTournament(tournamentId: string, userId: string): Promise<any> {
    const tournament = await this.getTournamentById(tournamentId);
    
    // Check if already enrolled
    const existing = await this.enrollmentRepo.findOne({ where: { tournamentId, userId } });
    if (existing) {
      return { enrolled: true, message: 'Already enrolled' };
    }

    // Check capacity
    if (tournament.participantsCount >= tournament.maxParticipants) {
      throw new BadRequestException('Tournament is fully booked');
    }

    // If entry is paid, require payment flow first
    if (tournament.entryFee > 0) {
      // In a real flow, we would generate a Razorpay order here
      // For now, return a signal that payment is required
      return { 
        requiresPayment: true, 
        entryFee: tournament.entryFee,
        message: 'Payment required to enroll' 
      };
    }

    // Free tournament: enroll directly
    const enrollment = this.enrollmentRepo.create({
      tournamentId,
      userId,
    });
    await this.enrollmentRepo.save(enrollment);

    // Update participants count
    tournament.participantsCount += 1;
    await this.tournamentRepo.save(tournament);

    return { enrolled: true, message: 'Successfully enrolled' };
  }

  async getEnrolledTournaments(userId: string): Promise<TournamentEntity[]> {
    const enrollments = await this.enrollmentRepo.find({
      where: { userId },
      relations: ['tournament'],
    });
    return enrollments.map(e => e.tournament);
  }
}
