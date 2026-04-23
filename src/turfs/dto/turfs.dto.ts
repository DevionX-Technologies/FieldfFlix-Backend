import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsArray,
  MaxLength,
  Min,
  Max,
  ValidateNested,
  IsInt,
  IsNotEmpty,
  Matches,
  IsUUID,
  IsLatitude,
  IsLongitude,
} from 'class-validator';
import { ESurfaceType, ESportsSupported } from '../enum/turfs.enum'; // Update this path according to your project structure
import { Type } from 'class-transformer';

export class CreateTurfAmenitiesDto {
  @ApiPropertyOptional({ example: true, description: 'Parking availability' })
  @IsOptional()
  @IsBoolean()
  has_parking?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Changing room availability',
  })
  @IsOptional()
  @IsBoolean()
  has_changing_room?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Washroom availability' })
  @IsOptional()
  @IsBoolean()
  has_washroom?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Drinking water availability',
  })
  @IsOptional()
  @IsBoolean()
  has_drinking_water?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'First aid availability',
  })
  @IsOptional()
  @IsBoolean()
  has_first_aid?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Floodlights availability',
  })
  @IsOptional()
  @IsBoolean()
  has_floodlights?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Equipment rental availability',
  })
  @IsOptional()
  @IsBoolean()
  has_equipment_rental?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Refreshments availability',
  })
  @IsOptional()
  @IsBoolean()
  has_refreshments?: boolean;

  @ApiPropertyOptional({ example: true, description: 'WiFi availability' })
  @IsOptional()
  @IsBoolean()
  has_wifi?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Seating area availability',
  })
  @IsOptional()
  @IsBoolean()
  has_seating_area?: boolean;

  @ApiPropertyOptional({
    type: [Object],
    description: 'Array of amenity objects with key, label, active, iconKey',
    example: [
      { key: 'parking', label: 'Parking', active: true, iconKey: 'car' },
      { key: 'wifi', label: 'WiFi', active: false, iconKey: 'wifi' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  amenities_details?: Array<{
    key: string;
    label: string;
    active: boolean;
    iconKey: string;
  }>;
}

export class CreateTurfDto {
  @ApiProperty({ example: 'Awesome Turf', description: 'Name of the turf' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    example: 'A great place to play football',
    description: 'Description of the turf',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 100.5,
    description: 'Length of the turf in meters',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  size_length?: number;

  @ApiPropertyOptional({
    example: 50.2,
    description: 'Width of the turf in meters',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  size_width?: number;

  @ApiProperty({
    example: [ESurfaceType.ARTIFICIAL_GRASS],
    description: 'Surface type of the turf',
    isArray: true,
    enum: ESurfaceType,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ESurfaceType, { each: true })
  surface_type?: ESurfaceType[];

  @ApiProperty({
    example: [ESportsSupported.FOOTBALL],
    description: 'Sports supported on the turf',
    isArray: true,
    enum: ESportsSupported,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ESportsSupported, { each: true })
  sports_supported?: ESportsSupported[];

  @ApiPropertyOptional({
    example: 12.971598,
    description: 'Latitude of the turf',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    example: 77.594566,
    description: 'Longitude of the turf',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiProperty({
    example: '123 Turf Street',
    description: 'Address of the turf',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address_line?: string;

  @ApiPropertyOptional({
    example: 'Bangalore',
    description: 'City where the turf is located',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    example: 'Karnataka',
    description: 'State where the turf is located',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({
    example: '560001',
    description: 'Postal code of the turf',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  postal_code?: string;

  @ApiPropertyOptional({
    example: 'India',
    description: 'Country where the turf is located',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({
    example: 'Koramangala, Bangalore',
    description: 'Location name or address for the turf',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({
    example: 500,
    description: 'Hourly rate to use the turf',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourly_rate?: number;

  @ApiPropertyOptional({
    example: '06:00:00',
    description: 'Opening time of the turf',
  })
  @IsOptional()
  @IsString()
  opening_time?: string;

  @ApiProperty({ example: '22:00:00', description: 'Closing time of the turf' })
  @IsString()
  closing_time: string;

  @ApiPropertyOptional({
    example: 20,
    description: 'Maximum capacity of the turf',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  max_capacity?: number;

  @ApiPropertyOptional({
    example: '+1234567890',
    description: 'Contact phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contact_phone?: string;

  @ApiPropertyOptional({
    example: 'info@turf.com',
    description: 'Contact email address',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contact_email?: string;

  @ApiPropertyOptional({
    example: '24 hours prior notice required',
    description: 'Cancellation policy',
  })
  @IsOptional()
  @IsString()
  cancellation_policy?: string;

  @ApiProperty({
    description: 'Amenities available for the turf',
    type: CreateTurfAmenitiesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateTurfAmenitiesDto)
  amenities?: CreateTurfAmenitiesDto;
}

export class UpdateTurfDto {
  @ApiProperty({ example: 'Awesome Turf', description: 'Name of the turf' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    example: 'A great place to play football',
    description: 'Description of the turf',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 100.5,
    description: 'Length of the turf in meters',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  size_length?: number;

  @ApiPropertyOptional({
    example: 50.2,
    description: 'Width of the turf in meters',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  size_width?: number;

  @ApiProperty({
    example: [ESurfaceType.ARTIFICIAL_GRASS],
    description: 'Surface type of the turf',
    isArray: true,
    enum: ESurfaceType,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ESurfaceType, { each: true })
  surface_type?: ESurfaceType[];

  @ApiProperty({
    example: [ESportsSupported.FOOTBALL],
    description: 'Sports supported on the turf',
    isArray: true,
    enum: ESportsSupported,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ESportsSupported, { each: true })
  sports_supported?: ESportsSupported[];

  @ApiPropertyOptional({
    example: 12.971598,
    description: 'Latitude of the turf',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    example: 77.594566,
    description: 'Longitude of the turf',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiProperty({
    example: '123 Turf Street',
    description: 'Address of the turf',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address_line?: string;

  @ApiPropertyOptional({
    example: 'Bangalore',
    description: 'City where the turf is located',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    example: 'Karnataka',
    description: 'State where the turf is located',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({
    example: '560001',
    description: 'Postal code of the turf',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  postal_code?: string;

  @ApiPropertyOptional({
    example: 'India',
    description: 'Country where the turf is located',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({
    example: 'Koramangala, Bangalore',
    description: 'Location name or address for the turf',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({
    example: 500,
    description: 'Hourly rate to use the turf',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourly_rate?: number;

  @ApiPropertyOptional({
    example: '06:00:00',
    description: 'Opening time of the turf',
  })
  @IsOptional()
  @IsString()
  opening_time?: string;

  @ApiPropertyOptional({
    example: '22:00:00',
    description: 'Closing time of the turf',
  })
  @IsOptional()
  @IsString()
  closing_time?: string;

  @ApiPropertyOptional({
    example: 20,
    description: 'Maximum capacity of the turf',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  max_capacity?: number;

  @ApiPropertyOptional({ example: true, description: 'Status of the turf' })
  @IsOptional()
  @IsBoolean()
  is_active: boolean;

  @ApiPropertyOptional({
    example: '+1234567890',
    description: 'Contact phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contact_phone?: string;

  @ApiPropertyOptional({
    example: 'info@turf.com',
    description: 'Contact email address',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contact_email?: string;

  @ApiPropertyOptional({
    example: '24 hours prior notice required',
    description: 'Cancellation policy',
  })
  @IsOptional()
  @IsString()
  cancellation_policy?: string;
}

export class GetTurfsQueryDto {
  @ApiPropertyOptional({
    example: 'Sports Arena',
    description: 'Name of the turf',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ default: 1, description: 'Page number', example: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({
    default: 10,
    description: 'Number of records to retrieve',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    enum: ESurfaceType,
    description: 'Surface type of the turf',
    default: ESurfaceType.ARTIFICIAL_GRASS,
  })
  @IsOptional()
  @IsString()
  // @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsEnum(ESurfaceType)
  surface_type?: ESurfaceType;

  @ApiPropertyOptional({
    enum: ESportsSupported,
    description: 'Sports supported',
    default: ESportsSupported.FOOTBALL,
  })
  @IsOptional()
  @IsString()
  // @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsEnum(ESportsSupported)
  sports_supported?: ESportsSupported;

  @ApiPropertyOptional({
    example: 'Mumbai',
    description: 'City where the turf is located',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    example: 'Maharashtra',
    description: 'State where the turf is located',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    example: 'India',
    description: 'Country where the turf is located',
  })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    example: 100,
    description: 'Maximum capacity of people the turf can accommodate',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  max_capacity?: number;

  @ApiPropertyOptional({
    example: '400001',
    description: 'Postal code of the turf location',
  })
  @IsOptional()
  @IsString()
  postal_code?: string;

  @ApiPropertyOptional({
    example: 1000,
    description: 'Minimum hourly rate for the turf',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  hourly_rate_min?: number;

  @ApiPropertyOptional({
    example: 2000,
    description: 'Maximum hourly rate for the turf',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  hourly_rate_max?: number;

  @ApiPropertyOptional({
    example: 19.076,
    description: 'Latitude coordinate',
  })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({
    example: 72.8777,
    description: 'Longitude coordinate',
  })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Search radius in kilometers',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  radius?: number; // Radius in kilometers

  @ApiPropertyOptional({
    example: 'Koramangala, Bangalore',
    description: 'Location name or address for the turf',
  })
  @IsOptional()
  @IsString()
  location?: string;
}

export class DeletingTurfImageDto {
  @ApiProperty({
    example: 1,
    description: 'ID of the turf image to be deleted',
  })
  @IsNotEmpty()
  @IsUUID()
  turf_image_id: string;

  @ApiProperty({
    example: 1,
    description: 'ID of the turf to which the image belongs',
  })
  @IsNotEmpty()
  @IsUUID()
  turf_id: string;
}

export class UploadFileDetailsInsertsInDbDto {
  @ApiProperty({
    description:
      'The complete filename with extension that will be used when storing the file.',
    example: 'medical-report-2023.pdf',
  })
  @IsString()
  @IsNotEmpty()
  file_name: string;

  @ApiProperty({
    description:
      'The standard MIME type that identifies the format of the file. Common types include application/pdf, image/jpeg, image/png, application/msword',
    example: 'application/pdf',
  })
  @IsString()
  @IsNotEmpty()
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

  @ApiProperty({
    description:
      'This is a boolean value that indicates whether the file is a turf profile picture or not.',
    example: false,
  })
  @IsBoolean()
  @IsNotEmpty()
  is_turf_profile: boolean;

  @ApiPropertyOptional({
    description:
      'The specific S3 bucket name where the file will be stored. If not specified, system will use the default storage bucket.',
    example: 'medical-documents-bucket',
  })
  @IsString()
  @IsOptional()
  bucket_name?: string;

  @ApiPropertyOptional({
    description:
      'The complete path within the S3 bucket where the file will be stored, including any folders/prefixes',
    example: 'patient-records/2023/12345/',
  })
  @IsString()
  @IsOptional()
  image_url: string;
}

export class InsertsTurfImageDto {
  @ApiProperty({
    description: 'Unique identifier of the lead/patient in the system',
    example: 12345,
  })
  @IsNotEmpty()
  @IsUUID()
  turf_id: string;

  @ApiPropertyOptional({
    type: [UploadFileDetailsInsertsInDbDto],
    description:
      'Array of document details to be uploaded for the lead/patient',
    example: [
      {
        file_name: 'medical-report-2023.pdf',
        content_type: 'application/pdf',
        file_size: '1234567890',
        bucket_name: 'medical-documents-bucket',
        image_url: 'patient-records/2023/12345/',
        is_turf_profile: false,
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @Type(() => UploadFileDetailsInsertsInDbDto)
  @ValidateNested({ each: true })
  uploadFileDetailsInsertsInDb: UploadFileDetailsInsertsInDbDto[];
}
