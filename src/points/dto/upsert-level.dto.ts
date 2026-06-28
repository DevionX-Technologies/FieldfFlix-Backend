import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertLevelDto {
  @ApiProperty({
    example: 2,
    description: 'The level number (must be unique)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  level: number;

  @ApiProperty({
    example: 10,
    description: 'Minimum points required to reach this level',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPoints: number;

  @ApiPropertyOptional({
    example: 'Silver',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
