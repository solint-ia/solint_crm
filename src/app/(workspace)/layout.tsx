import { DateFormatProvider } from '@/components/layout/date-format-provider';
import { NavigationRail } from '@/components/layout/navigation-rail';
import { ToastProvider } from '@/components/ui/toast';
import { NAV_ITEMS, reachesNavItem } from '@/config/navigation';
import { can, canSeeInbox } from '@/core/domain/user';
import { ConversationEventsProvider } from '@/features/realtime/conversation-events';
import { LiveNotificationsProvider } from '@/features/realtime/live-notifications';
import { container } from '@/infrastructure/container';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { asDateFormat } from '@/lib/datetime';

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
  const [conversations, inboxes, role, settings] = await Promise.all([
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
    // Só o formato de data: o perfil de empresa inteiro é um agregado grande, e
    // o layout precisa de um campo dele em toda tela autenticada.
    prisma.accountSettings.findUnique({
      where: { accountId: session.account.id },
      select: { company: true },
    }),
  ]);

  const dateFormat = asDateFormat(
    readJson<{ dateFormat?: string }>(settings?.company, {}).dateFormat,
  );

  /**
   * O selo conta **conversas**, não mensagens.
   *
   * Somava `unreadCount` de todas as conversas, e o número resultante não
   * respondia a nenhuma pergunta que alguém faça: um contato que mandou
   * quinze mensagens seguidas virava "15" ao lado do ícone, enquanto quinze
   * pessoas esperando viravam o mesmo "15". Quem olha o selo quer saber
   * **quantos atendimentos estão à espera** — é isso que dimensiona o trabalho
   * e é isso que a lista mostra quando ele clica.
   */
  const unreadCount = conversations.filter((conversation) => conversation.unreadCount > 0).length;

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
      // Mesma unidade do selo global: conversas esperando, não mensagens
      // acumuladas. Com as duas contagens iguais, a soma das caixas fecha com o
      // número do ícone — antes não fechava, e não havia como saber por quê.
      unreadCount: conversations.filter((c) => c.inboxId === inbox.id && c.unreadCount > 0).length,
    }));

  const items = NAV_ITEMS.filter((item) => reachesNavItem(session.permissions, item));

  return (
    <ConversationEventsProvider accountId={session.account.id}>
      {/* Mensagem nova vira aviso no sininho, e não mais cartão flutuante no
          canto: o cartão sumia sozinho em sete segundos e quem estivesse longe
          da tela nesse intervalo nunca soube que algo chegou. O provider mora
          aqui, no layout, porque o sininho é remontado a cada navegação e o
          que ele guardasse morreria na primeira troca de tela. */}
      <LiveNotificationsProvider
        soundEnabled={session.user.notifications.sound}
        accountId={session.account.id}
      >
        <ToastProvider>
          <DateFormatProvider value={dateFormat}>
            <div className="flex h-screen w-screen flex-col overflow-hidden bg-app md:flex-row">
              <NavigationRail
                items={items}
                unreadCount={unreadCount}
                userName={session.user.name}
                userTone={session.user.avatarTone}
                userAvatarUrl={session.user.avatarUrl}
                availability={session.user.availability}
                accessibleInboxes={accessibleInboxes}
                conversationCounts={conversationCounts}
                // O rodapé do menu leva para a seção de caixas de
                // `/configuracoes`, então a permissão exigida é exatamente a
                // daquela seção — `caixas:todas` diz quais caixas a pessoa
                // enxerga, não que ela administra o sistema, e um papel com
                // alcance amplo e sem acesso a ajustes veria um atalho para uma
                // tela que responderia "acesso negado".
                canManageInboxes={can(session, 'config.caixas:escrever')}
                roleName={role?.name ?? session.user.roleSlug}
              />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
            </div>
          </DateFormatProvider>
        </ToastProvider>
      </LiveNotificationsProvider>
    </ConversationEventsProvider>
  );
}
