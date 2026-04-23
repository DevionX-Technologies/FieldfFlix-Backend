import {
  Controller,
  Get,
  Param,
  Req,
  Query,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { Request } from 'express';
import { NotificationEntity } from './entities/notification.entity';
import { QueryNotificationDto } from './dto/notification.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Pagination } from 'tekvo-nest-typeorm-paginate';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('notification')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get(':id')
  findNotificationById(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<NotificationEntity> {
    return this.notificationService.findNotificationById(req, id);
  }

  @Get()
  async findNotificationDataByFilter(
    @Req() req: Request,
    @Query() queryNotificationPayload: QueryNotificationDto,
  ): Promise<Pagination<NotificationEntity> | []> {
    return await this.notificationService.findNotificationDataByFilter(
      req,
      queryNotificationPayload,
    );
  }

  @Get('user/count')
  countNotificationsByUserId(@Req() req: Request): Promise<number> {
    return this.notificationService.countNotificationsByUserId(req);
  }

  @Patch('/:id')
  softDelete(@Param('id') id: string): Promise<string> {
    return this.notificationService.softDelete(id);
  }
}
