import { Injectable, Logger } from '@nestjs/common';
import {
  CreateNotificationDto,
  QueryNotificationDto,
} from './dto/notification.dto';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonService } from 'src/common/service/common.service';
import { NotificationEntity } from './entities/notification.entity';
import { MessageStatus } from 'src/constant/enum';
import {
  IPaginationOptions,
  paginate,
  Pagination,
} from 'tekvo-nest-typeorm-paginate';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    private readonly commonService: CommonService,
  ) {}

  async create(
    createNotificationDto: CreateNotificationDto,
  ): Promise<NotificationEntity> {
    const insertNotification = await this.notificationRepository.save(
      createNotificationDto,
    );
    return insertNotification;
  }

  async findNotificationById(
    req: Request,
    id: string,
  ): Promise<NotificationEntity | null> {
    const decode = await this.commonService.extractDataFromToken(req);
    const userId = decode.user_id;
    await this.notificationRepository.update(
      { id, user_id: userId, is_soft_delete: false },
      { message_status: MessageStatus.READ, read_at: new Date() },
    );
    const notification = await this.notificationRepository.findOne({
      where: { id, user_id: userId, is_soft_delete: false },
    });
    return notification;
  }

  async countNotificationsByUserId(req: Request): Promise<number> {
    const decode = await this.commonService.extractDataFromToken(req);
    const userId = decode.user_id;
    const count = await this.notificationRepository.count({
      where: {
        user_id: userId,
        message_status: MessageStatus.UNREAD,
        is_soft_delete: false,
      },
      cache: true,
    });

    this.logger.log(`Total notifications: ${count}`);
    return count;
  }

  async findNotificationDataByFilter(
    req: Request,
    queryNotificationPayload: QueryNotificationDto,
  ): Promise<Pagination<NotificationEntity> | []> {
    const options: IPaginationOptions = {
      page: queryNotificationPayload.page || 1,
      limit: queryNotificationPayload.limit || 10,
    };
    const decode = await this.commonService.extractDataFromToken(req);
    const userId = decode.user_id;

    const queryBuilder =
      this.notificationRepository.createQueryBuilder('notification');

    queryBuilder.where('notification.user_id = :userId', { userId });
    queryBuilder.andWhere('notification.is_soft_delete = :isSoftDelete', {
      isSoftDelete: false,
    });
    if (
      queryNotificationPayload.startDate &&
      queryNotificationPayload.endDate
    ) {
      queryBuilder.andWhere(
        'notification.created_at BETWEEN :startDate AND :endDate',
        {
          startDate: queryNotificationPayload.startDate,
          endDate: queryNotificationPayload.endDate,
        },
      );
    }

    if (queryNotificationPayload.notification_type) {
      queryBuilder.andWhere(
        'notification.notification_type = :notificationType',
        {
          notificationType: queryNotificationPayload.notification_type,
        },
      );
    }

    if (queryNotificationPayload.message_status) {
      queryBuilder.andWhere('notification.message_status = :messageStatus', {
        messageStatus: queryNotificationPayload.message_status,
      });
    }

    // Add sorting by created_at in descending order
    queryBuilder.orderBy('notification.created_at', 'DESC');

    this.logger.debug(
      `QueryBuilder: ${JSON.stringify(queryBuilder.getQuery())}`,
    );

    const items = await paginate<NotificationEntity>(queryBuilder, options);

    return items?.items ? items : [];
  }

  async softDelete(id: string): Promise<string> {
    await this.notificationRepository.update(
      { id: id },
      { is_soft_delete: true },
    );

    return 'Notification deleted successfully';
  }
}
