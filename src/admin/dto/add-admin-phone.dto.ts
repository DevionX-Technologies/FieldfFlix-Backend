import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class AddAdminPhoneDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(20)
  /** Any format; last 10 digits are used. */
  phone: string;
}
