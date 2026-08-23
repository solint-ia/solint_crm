import { NavigationRail } from '@/components/layout/navigation-rail';
import { ToastProvider } from '@/components/ui/toast';
import { NAV_ITEMS } from '@/config/navigation';
import { can } from '@/core/domain/user';
import { ConversationEventsProvider } from '@/features/realtime/conversation-events';
import { RealtimeToasts } from '@/features/realtime/realtime-toasts';
import { container } from '@/infrastructure/container';

/**
 * Shell das telas autenticadas: rail global + area de conteúdo.
 * A rail so exibe itens permitidos pelo papel do usuário (RBAC no servidor).
 *
 * No celular o eixo vira coluna: a rail se transforma na barra de topo com
 * gaveta (ver `NavigationRail`) e o conteúdo ocupa a largura inteira.
 */
export default async function WorkspaceLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const session = await container.session.getCurrentSession();
  const conversations = await container.conversations.list(session.account.id, session.user.id, {
    scope: 'todas',
  });
  const unreadCount = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );

  const items = NAV_ITEMS.filter((item) => can(session, item.permission));

  return (
    <ConversationEventsProvider>
      <ToastProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-app md:flex-row">
          <NavigationRail
            items={items}
            unreadCount={unreadCount}
            userName={session.user.name}
            userTone={session.user.avatarTone}
            availability={session.user.availability}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </div>
        <RealtimeToasts />
      </ToastProvider>
    </ConversationEventsProvider>
  );
}
