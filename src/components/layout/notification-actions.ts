'use server';

import { container } from '@/infrastructure/container';

export async function markNotificationAsReadAction(notificationId: string): Promise<{ ok: boolean }> {
  const session = await container.session.getSession();
  if (!session) return { ok: false };

  try {
    await container.notifications.markAsRead(session.account.id, session.user.id, notificationId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Abrir a conversa apaga o aviso dela.
 *
 * Chamada de dentro da caixa de entrada, e não só do clique no sininho: quem
 * chega à conversa pela lista viu a mesma coisa que o aviso anunciava, e um
 * selo que continua contando o que já foi lido deixa de ser um selo — vira
 * ruído que a pessoa aprende a ignorar.
 */
export async function markConversationNotificationsAsReadAction(
  conversationId: string,
): Promise<{ ok: boolean }> {
  const session = await container.session.getSession();
  if (!session || !conversationId) return { ok: false };

  try {
    await container.notifications.markConversationAsRead(
      session.account.id,
      session.user.id,
      conversationId,
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function markAllNotificationsAsReadAction(): Promise<{ ok: boolean }> {
  const session = await container.session.getSession();
  if (!session) return { ok: false };

  try {
    await container.notifications.markAllAsRead(session.account.id, session.user.id);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
