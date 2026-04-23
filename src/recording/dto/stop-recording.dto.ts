import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

/**
 * DTO for stopping an ongoing recording.
 */
export class StopRecordingDto {
  @ApiProperty({ description: 'ID of the recording to stop' })
  @IsNotEmpty()
  @IsUUID()
  recordingId: string;
}
