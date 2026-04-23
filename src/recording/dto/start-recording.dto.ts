import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

/**
 * DTO for starting a new recording.
 */
export class StartRecordingDto {
  @ApiProperty({ description: 'ID of the user initiating the recording' })
  @IsNotEmpty()
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'ID of the turf' })
  @IsNotEmpty()
  @IsUUID()
  turfId: string;

  @ApiProperty({ description: 'ID of the camera to record from' })
  @IsNotEmpty()
  @IsUUID()
  cameraId: string;

  @ApiPropertyOptional({ description: 'Optional metadata for the recording' })
  @IsOptional()
  // You can define a more specific type for metadata if needed
  metadata?: any;
}
