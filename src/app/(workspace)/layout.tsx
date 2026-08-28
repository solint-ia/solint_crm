import { NavigationRail } from '@/components/layout/navigation-rail';
import { ToastProvider } from '@/components/ui/toast';
import { NAV_ITEMS } from '@/config/navigation';
import { can, canSeeInbox } from '@/core/domain/user';
import { ConversationEventsProvider } from '@/features/realtime/conversation-events';
import { RealtimeToasts } from '@/features/realtime/realtime-toasts';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';

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
  const [conversations, inboxes, role] = await Promise.all([
    container.conversations.list(session.account.id, session.user.id, {
      scope: 'todas',
      inboxAccess: session.inboxAccess,
    }),
    prisma.inbox.findMany({
      where: { accountId: session.account.id },
      include: { waConnection: { select: { status: true, phoneJid: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.role.findUnique({
      where: {
        accountId_slug: { accountId: session.account.id, slug: session.user.roleSlug },
      },
      select: { name: true },
    }),
  ]);

  const unreadCount = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );

  const conversationCounts = {
    todas: conversations.length,
    minhas: conversations.filter((c) => c.assigneeId === session.user.id).length,
    nao_atribuidas: conversations.filter((c) => !c.assigneeId).length,
    naoLidas: conversations.filter((c) => c.unreadCount > 0).length,
  };

  const accessibleInboxes = inboxes
    .filter((inbox) => canSeeInbox(session, inbox.id))
    .map((inbox) => ({
      id: inbox.id,
      name: inbox.name,
      channel: inbox.channel,
      identifier: inbox.waConnection?.phoneJid
        ? inbox.waConnection.phoneJid.replace(/@s\.whatsapp\.net$/, '')
        : inbox.identifier,
      status: inbox.waConnection?.status ?? inbox.status,
      teamName: inbox.teamName ?? undefined,
      unreadCount: conversations
        .filter((c) => c.inboxId === inbox.id && c.unreadCount > 0)
        .reduce((sum, c) => sum + c.unreadCount, 0),
    }));

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
            accessibleInboxes={accessibleInboxes}
            conversationCounts={conversationCounts}
            canManageInboxes={can(session, 'configuracoes:escrever') || can(session, 'caixas:todas')}
            roleName={role?.name ?? session.user.roleSlug}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </div>
        <RealtimeToasts />
      </ToastProvider>
    </ConversationEventsProvider>
  );
}
