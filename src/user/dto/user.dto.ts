import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsPhoneNumber,
  ValidateIf,
} from 'class-validator';
import { SingUpType } from 'src/auth/enum/auth.enum';

export class UpdateUserFmcTokenDto {
  @ApiProperty({ type: String, example: '' })
  @IsOptional()
  @IsString()
  deviceId: string;
}

export class CreateUserDto {
  @ApiProperty({ example: 'John Doe', description: 'User full name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: 'user_uploads',
    description: 'User upload image bucket name',
  })
  @IsOptional()
  @IsString()
  bucket_name?: string;
  @ApiPropertyOptional({
    example: false,
    description: 'Email verification status',
  })
  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;

  @ApiPropertyOptional({
    example: '+1234567890',
    description: 'User phone number',
  })
  @IsOptional()
  @IsPhoneNumber()
  phone_number?: string;

  @ApiPropertyOptional({
    example: 'profile_image.jpg',
    description: 'User profile image path',
  })
  @IsOptional()
  @IsString()
  profile_image_path?: string;

  @ApiPropertyOptional({
    enum: SingUpType,
    enumName: 'SingUpType',
    description: 'User login method',
  })
  @IsOptional()
  @IsEnum(SingUpType)
  singUp_Method?: SingUpType;
}

export class GetUserPhoneNumberOrEmail {
  @ApiPropertyOptional({
    example: 'user@example.com',
    description: 'User email address',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
  @ApiPropertyOptional({
    example: '+1234567890',
    description: 'User phone number',
  })
  @IsOptional()
  @IsString()
  phone_number?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'John Doe',
    description: 'User full name',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'user@example.com',
    description: 'User email address',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({
    example: '+91 797113822',
    description: 'Enter the Phone number',
  })
  @IsOptional()
  @IsString()
  phone_number?: string;
}
