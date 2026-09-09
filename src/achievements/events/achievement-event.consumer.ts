import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AchievementUnlockedEvent } from './achievement-unlocked.event';
import { User } from 'src/user/entities/user.entity';
import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { FireBaseNotificationService } from 'src/common/service/fire-base.service';
import { MessageStatus, NotificationType } from 'src/constant/enum';

@Injectable()
export class AchievementEventConsumer {
  private readonly logger = new Logger(AchievementEventConsumer.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    private readonly fireBaseNotificationService: FireBaseNotificationService,
  ) {}

  @OnEvent(AchievementUnlockedEvent.EVENT_NAME, { async: true })
  async handleAchievementUnlocked(event: AchievementUnlockedEvent): Promise<void> {
    const {
      userId,
      achievementId,
      title,
      description,
      xpReward,
      tier,
      category,
      badgeAssetKey,
      unlockedAt,
    } = event;

    this.logger.log(
      `Processing unlock event for user ${userId}: Achievement '${achievementId}' (${title}) - Reward: +${xpReward} XP`,
    );

    try {
      const user = await this.userRepo.findOne({
        where: { id: userId },
        relations: ['user_devices_token'],
      });

      if (!user) {
        this.logger.warn(`User ${userId} not found when dispatching achievement notification`);
        return;
      }

      const notificationTitle = `🏆 Achievement Unlocked: ${title}!`;
      const notificationBody = `You earned '${title}' (+${xpReward} XP). Claim your reward now!`;

      // 1. Dispatch Push Notifications to all user active device tokens
      const tokens = user.user_devices_token ?? [];
      for (const t of tokens) {
        const token = (t as { devices_id?: string })?.devices_id;
        if (!token) continue;

        try {
          await this.fireBaseNotificationService.sendNotification(
            {
              notification: {
                title: notificationTitle,
                body: notificationBody,
              },
              token,
              data: {
                click_action: 'ACHIEVEMENT_UNLOCKED',
                type: 'ACHIEVEMENT_UNLOCKED',
                achievementId,
                title,
                xpReward: String(xpReward),
                tier: String(tier),
                category: String(category),
                badgeAssetKey: badgeAssetKey || '',
                unlockedAt: unlockedAt.toISOString(),
              } as unknown as { click_action: string },
            },
            user.id,
          );
        } catch (err) {
          this.logger.warn(
            `FCM send failed for user=${user.id} token=${token.slice(0, 8)}…: ${(err as Error)?.message ?? err}`,
          );
        }
      }

      // 2. Persist in-app notification row for notifications drawer & modal trigger
      await this.notificationRepo.save({
        user_id: user.id,
        title: notificationTitle,
        body: notificationBody,
        data: [
          {
            achievementId,
            title,
            description,
            xpReward,
            tier,
            category,
            badgeAssetKey,
            unlockedAt: unlockedAt.toISOString(),
          },
        ],
        message_status: MessageStatus.UNREAD,
        notification_type: NotificationType.ACHIEVEMENT_UNLOCKED,
        is_soft_delete: false,
      } as unknown as Partial<NotificationEntity>);

      this.logger.log(`Dispatched unlock notifications for user ${userId} and achievement ${achievementId}`);
    } catch (err) {
      this.logger.error(
        `Failed to process AchievementUnlockedEvent for user ${userId}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
