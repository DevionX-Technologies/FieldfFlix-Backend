import {
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  IsIn,
  IsDateString,
  Min,
  Max,
} from 'class-validator';

export class CreateGameDto {
  @IsUUID()
  tournamentId: string;

  @IsOptional()
  @IsString()
  fixtureRef?: string;

  @IsOptional()
  @IsUUID()
  recordingId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  courtNumber?: number;

  @IsOptional()
  @IsUUID()
  cameraId?: string;

  @IsOptional()
  @IsString()
  round?: string;

  @IsOptional()
  @IsString()
  teamA?: string;

  @IsOptional()
  @IsString()
  teamB?: string;

  @IsOptional()
  @IsString()
  score?: string;

  @IsOptional()
  @IsIn(['scheduled', 'live', 'completed', 'cancelled'])
  status?: 'scheduled' | 'live' | 'completed' | 'cancelled';

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
