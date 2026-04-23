import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * DTO for updating a recording's display name (PATCH body).
 */
export class UpdateRecordingNameDto {
  @ApiProperty({
    description: 'Display name for the recording',
    example: 'My Game Highlights',
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  recording_name: string;
}
