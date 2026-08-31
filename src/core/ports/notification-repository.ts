import type { AppNotification } from '../domain/notification';
import type { Id } from '../domain/shared';

export interface NotificationRepository {
  list(accountId: Id, userId: Id): Promise<readonly AppNotification[]>;
  markAsRead(accountId: Id, userId: Id, notificationId: Id): Promise<void>;
  markAllAsRead(accountId: Id, userId: Id): Promise<void>;
  /**
   * Marca como lidos os avisos que apontam para uma conversa.
   *
   * Existe porque abrir a conversa **é** ler o aviso: quem chegou lá — pelo
   * sininho ou pela caixa de entrada — já viu o que o aviso tinha a dizer, e
   * deixá-lo aceso obriga a pessoa a repetir na mão o que ela acabou de fazer.
   */
  markConversationAsRead(accountId: Id, userId: Id, conversationId: Id): Promise<void>;
}
