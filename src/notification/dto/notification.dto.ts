import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsArray,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsInt,
} from 'class-validator';
import { MessageStatus, NotificationType } from 'src/constant/enum';

export class RegulatoryNotificationDto {
  @ApiProperty({ description: 'ID of the user', example: 'main/dev' })
  @IsNotEmpty()
  @IsString()
  sub_vertical_access: string;

  @ApiProperty({
    description: 'Regulatory url',
    example: 'https://www.google.com/regulatory/12345',
  })
  @IsNotEmpty()
  @IsString()
  regulatory_url: string;

  @ApiProperty({ description: 'meta_data', example: 'meta_data' })
  @IsNotEmpty()
  @IsString()
  meta_data: string;
}

export class CreateNotificationDto {
  @ApiProperty({ description: 'ID of the user', example: '12345' })
  @IsNotEmpty()
  @IsString()
  user_id: string;

  @ApiProperty({ description: 'message title', example: '67890' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ description: 'message body', example: '67890' })
  @IsNotEmpty()
  @IsString()
  body: string;

  @ApiProperty({
    description: 'Data associated with the notification',
    example: ['data1', 'data2'],
  })
  @IsNotEmpty()
  @IsArray()
  data: any;

  @ApiProperty({
    description: 'Type of the notification',
    enum: NotificationType,
    example: NotificationType.RECORDING_START,
  })
  @IsEnum(NotificationType)
  @IsNotEmpty()
  notification_type: NotificationType;
}

export class UpdateNotificationDto {
  @ApiProperty({
    description: 'Type of the notification',
    example: MessageStatus.READ,
    enum: MessageStatus,
    enumName: 'ENotificationType',
  })
  @IsEnum(MessageStatus)
  @IsNotEmpty()
  message_status: MessageStatus;
}

export class QueryNotificationDto {
  @ApiPropertyOptional({
    description: 'Start date for filtering notifications',
    example: '2023-01-01',
  })
  @IsOptional()
  @Type(() => Date)
  startDate?: Date;

  @ApiPropertyOptional({
    description: 'End date for filtering notifications',
    example: '2023-12-31',
  })
  @IsOptional()
  @Type(() => Date)
  endDate?: Date;

  @ApiPropertyOptional({
    description: 'Type of the notification',
    enum: NotificationType,
    example: NotificationType.RECORDING_START,
  })
  @IsEnum(NotificationType)
  @IsOptional()
  notification_type?: NotificationType;

  @ApiPropertyOptional({
    description: 'Type of the notification',
    example: MessageStatus.READ,
    enum: MessageStatus,
    enumName: 'MessageStatus',
  })
  @IsEnum(MessageStatus)
  @IsOptional()
  message_status?: MessageStatus;

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
}
