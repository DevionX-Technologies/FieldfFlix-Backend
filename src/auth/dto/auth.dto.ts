import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SendOtpDto {
  @ApiProperty({
    description: 'Phone number in international format (with country code)',
    example: '919876543210',
  })
  @IsString()
  @IsNotEmpty()
  mobile: string;
}

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Phone number in international format (digits only, country code without +)',
    example: '919876543210',
  })
  @IsString()
  @IsNotEmpty()
  mobile: string;

  @ApiProperty({
    description: '6-digit code received by SMS (Fast2SMS DLT)',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;
}

export class AppleFullNameDto {
  @ApiPropertyOptional({ description: 'Family name', example: 'Doe' })
  @IsString()
  @IsOptional()
  familyName?: string;

  @ApiPropertyOptional({ description: 'Given name', example: 'John' })
  @IsString()
  @IsOptional()
  givenName?: string;

  @ApiPropertyOptional({ description: 'Middle name', example: 'Edward' })
  @IsString()
  @IsOptional()
  middleName?: string | null;

  @ApiPropertyOptional({ description: 'Name prefix', example: 'Dr.' })
  @IsString()
  @IsOptional()
  namePrefix?: string | null;

  @ApiPropertyOptional({ description: 'Name suffix', example: 'Jr.' })
  @IsString()
  @IsOptional()
  nameSuffix?: string | null;

  @ApiPropertyOptional({ description: 'Nickname', example: 'Johnny' })
  @IsString()
  @IsOptional()
  nickname?: string | null;
}

export class AppleAuthCallbackDto {
  @ApiPropertyOptional({
    description: 'The authorization code sent by Apple',
    example: 'AUTH_CODE_STRING',
  })
  @IsString()
  @IsOptional()
  authorizationCode?: string;

  @ApiPropertyOptional({
    description: 'Email address',
    example: 'john.doe@example.com',
  })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    type: () => AppleFullNameDto,
    description: 'Full name object provided by Apple',
  })
  @ValidateNested()
  @Type(() => AppleFullNameDto)
  @IsOptional()
  fullName?: AppleFullNameDto;

  @ApiPropertyOptional({
    description: 'The identity token provided by Apple',
    example: 'IDENTITY_TOKEN_STRING',
  })
  @IsString()
  @IsOptional()
  identityToken?: string;

  @ApiPropertyOptional({
    description: 'Unique user id provided by Apple',
    example: '000123.f31ef28...decf8.1322',
  })
  @IsString()
  @IsOptional()
  user?: string;
}
