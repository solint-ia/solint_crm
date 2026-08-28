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
