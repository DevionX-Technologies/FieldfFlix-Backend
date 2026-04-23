import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  ValidateNested,
  IsArray,
  IsNumber,
  Matches,
  IsInt,
} from 'class-validator';

class FileUploadDto {
  @ApiProperty({
    description:
      'The name of the file to be uploaded, including the extension.',
    example: 'example.pdf',
  })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({
    description:
      'The MIME type of the file to be uploaded. For a PDF, this should be application/pdf.',
    example: 'application/pdf',
  })
  @IsString()
  @IsNotEmpty()
  contentType: string;

  @ApiProperty({
    description:
      'Optional. The subfolder within the S3 bucket where the file should be stored.',
    example: 'user-documents/',
    required: false,
  })
  @IsString()
  @IsOptional()
  subfolder?: string;

  @ApiPropertyOptional({
    description:
      'Optional. Tags for the file, provided as any key-value pairs.',
    example: { Key1: 'Value1', Key2: 'Value2' },
    type: 'object',
    additionalProperties: {
      type: 'string',
    },
    required: false,
  })
  @IsObject()
  @IsOptional()
  tags?: Record<string, string>;
}

export class UploadFileInS3Dto {
  @ApiProperty({
    type: [FileUploadDto],
    description: 'List of files to be uploaded',
  })
  @ValidateNested({ each: true })
  @Type(() => FileUploadDto)
  @IsArray()
  @IsNotEmpty()
  files: FileUploadDto[];

  @ApiPropertyOptional({
    description:
      'The name of the S3 bucket where the files should be stored. If not provided, the default bucket will be used.',
    example: 'user-uploads',
  })
  @IsString()
  @IsOptional()
  bucketName?: string;
}

export class UploadsSignedUrlQuery {
  @ApiProperty({
    description: 'The key for generate sign url',
    example: 'searchTerm/',
  })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiPropertyOptional({
    description:
      'The name of the S3 bucket where the files should be stored. If not provided, the default bucket will be used.',
    example: 'user-uploads',
  })
  @IsString()
  @IsOptional()
  bucketName?: string;
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
  mime_type: string;

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
      'The original source URL or location where the file can be accessed from',
    example: 'https://medical-records.example.com/patient/12345/report.pdf',
  })
  @IsString()
  @IsNotEmpty()
  document_source: string;

  @ApiProperty({
    description:
      'Numeric identifier representing the type of document. E.g., 1 for Medical Records, 2 for Insurance Forms, 3 for Legal Documents',
    example: 'Medical Records',
  })
  @IsString()
  @IsNotEmpty()
  document_type: string;

  @ApiPropertyOptional({
    description:
      'The specific S3 bucket name where the file will be stored. If not specified, system will use the default storage bucket.',
    example: 'medical-documents-bucket',
  })
  @IsString()
  @IsOptional()
  s3_bucket?: string;

  @ApiPropertyOptional({
    description:
      'The complete path within the S3 bucket where the file will be stored, including any folders/prefixes',
    example: 'patient-records/2023/12345/',
  })
  @IsString()
  @IsOptional()
  s3_path: string;
}

export class InsertsDocumentDto {
  @ApiProperty({
    description: 'Unique identifier of the lead/patient in the system',
    example: 12345,
  })
  @IsNumber()
  @IsNotEmpty()
  lead_id: number;

  @ApiPropertyOptional({
    type: [UploadFileDetailsInsertsInDbDto],
    description:
      'Array of document details to be uploaded for the lead/patient',
    example: [
      {
        file_name: 'medical-report-2023.pdf',
        mime_type: 'application/pdf',
        document_source:
          'https://medical-records.example.com/patient/12345/report.pdf',
        document_type: 'Medical Records',
        s3_bucket: 'medical-documents-bucket',
        s3_path: 'patient-records/2023/12345/',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @Type(() => UploadFileDetailsInsertsInDbDto)
  @ValidateNested({ each: true })
  uploadFileDetailsInsertsInDb: UploadFileDetailsInsertsInDbDto[];
}

export class UpdatedSendDocumentsDto {
  @ApiProperty({
    description: 'Unique identifier of the lead/patient in the system',
    example: 12345,
  })
  @IsInt()
  @Type(() => Number)
  @IsNotEmpty()
  lead_id: number;

  @ApiProperty({
    description: 'Unique identifier of the document in the system',
    example: 12345,
  })
  @IsInt()
  @Type(() => Number)
  @IsNotEmpty()
  document_id: number;
}

export class FindDocumentByLeadIdDto {
  @ApiProperty({
    description: 'Array of unique identifiers of the documents in the system',
    example: ['12345', '67890'],
    type: String,
    isArray: true,
  })
  @IsNotEmpty()
  @IsArray()
  lead_id: string[];
}
export class GetFileSingeUrlFromS3Dto {
  @ApiPropertyOptional({
    description:
      'The complete path within the S3 bucket where the file will be stored, including any folders/prefixes',
    example: 'patient-records/2023/12345/',
  })
  @IsString()
  @IsOptional()
  s3_path: string;

  @ApiPropertyOptional({
    description:
      'The specific S3 bucket name where the file will be stored. If not specified, system will use the default storage bucket.',
    example: 'medical-documents-bucket',
  })
  @IsString()
  @IsOptional()
  s3_bucket?: string;
}
