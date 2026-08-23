import type { AppNotification } from '../domain/notification';
import type { Id } from '../domain/shared';

export interface NotificationRepository {
  list(accountId: Id, userId: Id): Promise<readonly AppNotification[]>;
  markAllAsRead(accountId: Id, userId: Id): Promise<void>;
}
