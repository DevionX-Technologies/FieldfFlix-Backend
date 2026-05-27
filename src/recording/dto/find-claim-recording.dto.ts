import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

/**
 * Search-only DTO for `POST /recording/find`.
 *
 * The DB has duplicate turf rows (same display name, different UUIDs) created
 * by a buggy seed run. The Recordings screen passes EVERY alias UUID for the
 * picked venue here so cameras / recordings attached to a non-canonical row
 * still match. `courtNumber` is the human-meaningful selection — we look up
 * matching cameras at any of the alias turfs ourselves. cameraId is kept for
 * older clients but ignored when courtNumber is supplied.
 */
export class FindRecordingsDto {
  @ApiProperty({
    description:
      'One or more turf UUIDs (the picked venue and every alias UUID that name-collapses with it).',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  turfIds: string[];

  @ApiPropertyOptional({
    description: 'Court number at the venue (preferred over cameraId).',
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  courtNumber?: number;

  @ApiPropertyOptional({
    description:
      'Optional Camera UUID (legacy clients). Ignored if courtNumber is supplied.',
  })
  @IsUUID()
  @IsOptional()
  cameraId?: string;

  @ApiProperty({ description: 'Date of the game (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiProperty({ description: 'Start time of the game (HH:mm)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'startTime must be HH:mm',
  })
  startTime: string;

  @ApiProperty({ description: 'End time of the game (HH:mm)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'endTime must be HH:mm',
  })
  endTime: string;

  @ApiProperty({
    description:
      'Last 10 digits of the phone number of the person who started the recording',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, {
    message: 'phoneLast10 must be exactly 10 digits',
  })
  phoneLast10: string;
}

/**
 * Legacy single-turf-id DTO for `POST /recording/find-and-claim`. Kept so
 * older clients keep working; the controller forwards to the new search +
 * auto-claim path. New clients use `FindRecordingsDto` + a separate claim.
 */
export class FindAndClaimRecordingDto {
  @ApiProperty({
    description: 'The UUID of the Turf where the game was played',
  })
  @IsUUID()
  @IsNotEmpty()
  turfId: string;

  @ApiPropertyOptional({ description: 'Optional UUID of the Camera (Court)' })
  @IsUUID()
  @IsOptional()
  cameraId?: string;

  @ApiProperty({ description: 'Date of the game (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiProperty({ description: 'Start time of the game (HH:mm)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'startTime must be HH:mm',
  })
  startTime: string;

  @ApiProperty({ description: 'End time of the game (HH:mm)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'endTime must be HH:mm',
  })
  endTime: string;

  @ApiProperty({
    description:
      'Last 10 digits of the phone number of the person who started the recording',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, {
    message: 'phoneLast10 must be exactly 10 digits',
  })
  phoneLast10: string;
}
