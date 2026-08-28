import type { AppNotification } from '../domain/notification';
import type { Id } from '../domain/shared';

export interface NotificationRepository {
  list(accountId: Id, userId: Id): Promise<readonly AppNotification[]>;
  markAsRead(accountId: Id, userId: Id, notificationId: Id): Promise<void>;
  markAllAsRead(accountId: Id, userId: Id): Promise<void>;
}
