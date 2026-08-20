import { IsInt, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ActiveHighlightDto {
  @ApiProperty({
    description: 'The integer ID of the court/channel',
    example: 1,
  })
  @IsInt()
  court: number;

  @ApiProperty({
    description: 'Timestamp when the button was pressed',
    example: '2026-08-20T17:35:00Z',
    required: false,
  })
  @IsOptional()
  @IsString()
  pressedAt?: string;

  @ApiProperty({
    description:
      'Direct S3 URL if the hardware device processed the highlight itself',
    required: false,
  })
  @IsOptional()
  @IsString()
  s3Path?: string;
}
