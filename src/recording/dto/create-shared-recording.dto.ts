import { IsUUID, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSharedRecordingDto {
  @ApiProperty({
    description: 'ID of the recording to be shared',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  recording_id: string;

  @ApiProperty({
    description: 'ID of the user to share the recording with',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  shared_with_user_id: string;
}
