import type { InboxScope } from '@/core/domain/conversation';
import { can, canSeeInbox } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';
import {
  assignConversationAction,
  cancelScheduledMessageAction,
  changeConversationPriorityAction,
  setConversationAiPauseAction,
  changeConversationStatusAction,
  deleteMessageAction,
  listScheduledMessagesAction,
  markConversationReadAction,
  moveConversationToInboxAction,
  reactToMessageAction,
  scheduleMessageAction,
  sendMediaAction,
  sendMessageAction,
  sendTemplateAction,
  setContactLabelsAction,
  setConversationLabelsAction,
  setOperatorTypingAction,
} from '@/app/(workspace)/conversas/actions';
import { InboxWorkspace } from './inbox-workspace';

/**
 * Carga da caixa de entrada.
 *
 * Separada da página para poder viver dentro de um `<Suspense>`: é este
 * componente que suspende enquanto lista as conversas, e é por isso que
 * `/conversas/[id]` consegue responder 404 antes de qualquer byte sair.
 *
 * O catálogo (agentes, etiquetas, templates, respostas rápidas) vem junto para
 * que transferir, etiquetar e escolher template não precisem de uma ida extra
 * ao servidor no meio do atendimento.
 */
export async function InboxData({
  selectedId,
  initialInboxId,
  initialScope,
  initialUnread,
}: {
  readonly selectedId?: string;
  readonly initialInboxId?: string;
  readonly initialScope?: InboxScope;
  readonly initialUnread?: boolean;
}) {
  const session = await container.session.getCurrentSession();
  if (!can(session, 'conversas:ler')) return <AccessDenied permission="conversas:ler" />;

  const [conversations, settings, templates] = await Promise.all([
    container.useCases.listConversations({
      accountId: session.account.id,
      currentUserId: session.user.id,
      filter: { scope: 'todas', inboxAccess: session.inboxAccess },
    }),
    container.settings.get(session.account.id),
    container.campaigns.listTemplates(session.account.id),
  ]);

  return (
    <InboxWorkspace
      conversations={conversations}
      currentUserId={session.user.id}
      currentUserName={session.user.name}
      companyName={session.account.name}
      // Só as caixas que esta pessoa alcança. `settings.connections` traz todas
      // as da conta; oferecer no menu de mover uma caixa fora do alcance seria
      // propor uma ação que o servidor recusa.
      inboxes={settings.connections
        .filter((connection) => canSeeInbox(session, connection.id))
        .map((connection) => ({
          id: connection.id,
          name: connection.name,
          // A coluna de canais desenha o ponto do canal e avisa quando o número
          // está fora do ar — os dois vêm da caixa, não da conversa.
          channel: connection.channel,
          status: connection.status,
        }))}
      canManageInboxes={can(session, 'config.caixas:escrever')}
      moveInbox={moveConversationToInboxAction}
      catalog={{ members: settings.members, labels: settings.labels, templates }}
      cannedResponses={settings.cannedResponses}
      sendMessage={sendMessageAction}
      deleteMessage={deleteMessageAction}
      reactToMessage={reactToMessageAction}
      scheduleMessage={scheduleMessageAction}
      listScheduledMessages={listScheduledMessagesAction}
      cancelScheduledMessage={cancelScheduledMessageAction}
      changeStatus={changeConversationStatusAction}
      markAsRead={markConversationReadAction}
      assign={assignConversationAction}
      changePriority={changeConversationPriorityAction}
      setAiPause={setConversationAiPauseAction}
      setLabels={setConversationLabelsAction}
      setContactLabels={setContactLabelsAction}
      sendTemplate={sendTemplateAction}
      sendMedia={sendMediaAction}
      setOperatorTyping={setOperatorTypingAction}
      {...(selectedId ? { initialSelectedId: selectedId } : {})}
      {...(initialInboxId ? { initialInboxId } : {})}
      {...(initialScope ? { initialScope } : {})}
      {...(initialUnread !== undefined ? { initialUnread } : {})}
    />
  );
}
