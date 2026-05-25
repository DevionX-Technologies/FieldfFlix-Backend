import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SubmitSupportContactDto {
  @IsIn(['bug', 'feature', 'general'])
  issueType: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName: string;

  /** Digits only, 10–15 (e.g. Indian local or with country code). */
  @IsString()
  @Matches(/^[0-9]{10,15}$/, {
    message: 'mobile must be 10–15 digits',
  })
  mobile: string;

  @IsString()
  @MinLength(3)
  @MaxLength(8000)
  description: string;
}
