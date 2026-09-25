import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ExtractMatchVideoDto {
  @IsOptional()
  @IsUUID()
  gameId?: string;

  @IsOptional()
  @IsUUID()
  tournamentId?: string;

  @IsOptional()
  @IsUUID()
  cameraId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  courtNumber?: number;

  @IsNotEmpty()
  @IsDateString()
  startTime: string;

  @IsNotEmpty()
  @IsDateString()
  endTime: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
