import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { EMediaUploadType, ESortOrder } from '../enum/media-upload.enum';
import { Type } from 'class-transformer';

export class CreateMediaUploadDto {
  @ApiProperty({
    description: 'ID of the turf where media is being uploaded',
    example: '123',
    required: true,
  })
  @IsUUID()
  turf_id: string;

  @ApiProperty({
    description: 'Original name of the uploaded file',
    example: 'match-highlights.mp4',
    required: true,
  })
  @IsString()
  file_name: string;

  @ApiProperty({
    description: 'Name of the storage bucket where file is stored',
    example: 'fieldflicks-media',
    required: true,
  })
  @IsString()
  bucket_name: string;

  @ApiProperty({
    description: 'ID of the user who uploaded the media',
    example: '123',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  user_id: string;

  @ApiProperty({
    description: 'Public URL to access the media file',
    example:
      'https://storage.googleapis.com/fieldflicks-media/match-highlights.mp4',
    required: true,
  })
  @IsString()
  media_url: string;

  @ApiProperty({
    description: 'Type of media being uploaded',
    enum: EMediaUploadType,
    example: EMediaUploadType.VIDEO,
    default: EMediaUploadType.VIDEO,
    required: true,
  })
  @IsEnum(EMediaUploadType)
  media_upload_type: EMediaUploadType;

  @ApiProperty({
    description: 'MIME type of the uploaded file',
    example: 'video/mp4',
    required: true,
  })
  @IsString()
  content_type: string;

  @ApiProperty({
    description:
      'The size of the file in bytes. This is a numeric value representing the size of the file.',
    example: '1234567890',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, {
    message: 'file_size must be a numeric string representing a large integer',
  })
  file_size: string;
}

export class QueryUserMediaDto {
  @ApiProperty({
    description: 'ID of the user whose media is being queried',
    example: 123,
    required: true,
  })
  @IsInt()
  @Type(() => Number)
  turfId: number;

  @ApiProperty({
    description: 'Type of media being uploaded',
    enum: ESortOrder,
    example: ESortOrder.NEW_TO_OLD,
    default: ESortOrder.NEW_TO_OLD,
    required: true,
  })
  @IsEnum(ESortOrder)
  sortOrder: ESortOrder;

  @ApiProperty({
    description: 'Type of media being uploaded',
    enum: EMediaUploadType,
    example: EMediaUploadType.VIDEO,
    default: EMediaUploadType.VIDEO,
    required: true,
  })
  @IsEnum(EMediaUploadType)
  media_upload_type: EMediaUploadType;
}

export class DeleteUserMediaDto {
  @ApiProperty({
    description: 'ID media is being queried',
    example: 123,
    required: true,
  })
  @IsNotEmpty()
  @IsUUID()
  media_id: string;
}
