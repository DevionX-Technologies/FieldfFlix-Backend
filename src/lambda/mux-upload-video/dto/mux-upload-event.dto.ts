import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
} from 'class-validator';

export class MuxUploadEventDto {
  @IsUUID()
  recordingId!: string;

  @IsString()
  @IsNotEmpty()
  s3Key!: string;

  @IsOptional()
  @IsString()
  bucketName?: string;

  @IsOptional()
  @IsUrl()
  presignedUrl?: string;
}
