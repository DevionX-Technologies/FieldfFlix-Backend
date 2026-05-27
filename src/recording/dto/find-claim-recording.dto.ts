import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

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
