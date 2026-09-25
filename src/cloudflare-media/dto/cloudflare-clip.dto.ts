import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CloudflareCreateClipDto {
  @ApiProperty({
    description: 'Parent recording UUID',
    example: 'd9b73f8a-9231-482a-a92c-68149adbc952',
  })
  @IsUUID()
  @IsNotEmpty()
  recordingId: string;

  @ApiProperty({
    description:
      'Start offset of the clip in seconds relative to the match video',
    example: 120,
  })
  @IsNumber()
  @IsNotEmpty()
  startTimeSeconds: number;

  @ApiProperty({
    description:
      'End offset of the clip in seconds relative to the match video',
    example: 150,
  })
  @IsNumber()
  @IsNotEmpty()
  endTimeSeconds: number;

  @ApiProperty({
    description: 'Optional highlight title or label',
    example: 'Epic Rally in 2nd Set',
    required: false,
  })
  @IsString()
  @IsOptional()
  title?: string;
}
