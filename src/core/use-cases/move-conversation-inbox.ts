import type { Conversation } from '../domain/conversation';
import { DomainError, fail, ok, type Result } from '../domain/shared';
import type { Id } from '../domain/shared';
import { can, canSeeInbox, type Session } from '../domain/user';
import type { ConversationRepository } from '../ports/conversation-repository';

export interface MoveConversationInboxInput {
  readonly session: Session;
  readonly conversationId: Id;
  readonly targetInboxId: Id;
}

/**
 * Move um atendimento para outra caixa de entrada.
 *
 * É a operação que existe porque uma conversa entra pelo número errado: o
 * cliente escreve no "Atendimento" cobrando uma fatura, e quem resolve é o
 * "Financeiro". Sem isto, a única saída era pedir ao cliente que mandasse de
 * novo para outro número.
 *
 * **Três regras, nesta ordem:**
 *
 *  1. Precisa de `conversas:mover-caixa` — separada de `conversas:transferir`,
 *     que é reatribuir a um colega. Empurrar um atendimento para outro setor é
 *     decisão de peso diferente.
 *  2. Quem move precisa alcançar **as duas** caixas. Alcançar só a de origem
 *     permitiria empurrar conversa para um setor que a pessoa não conhece;
 *     alcançar só a de destino permitiria puxar conversa de um setor a que ela
 *     não tem acesso — que é vazamento com passo extra.
 *  3. Se o responsável atual não alcança a caixa de destino, a conversa é
 *     **desatribuída**. Mantê-lo seria deixar um atendimento com dono que não
 *     consegue abri-lo: some da lista dele e não aparece na de mais ninguém.
 */
export const createMoveConversationInbox =
  (repository: ConversationRepository) =>
  async ({
    session,
    conversationId,
    targetInboxId,
  }: MoveConversationInboxInput): Promise<Result<Conversation>> => {
    if (!can(session, 'conversas:mover-caixa')) {
      return fail(
        new DomainError('Seu papel não permite mover conversas entre caixas.', 'FORBIDDEN'),
      );
    }

    if (!canSeeInbox(session, targetInboxId)) {
      return fail(
        new DomainError('Você não tem acesso à caixa de destino.', 'FORBIDDEN'),
      );
    }

    // O `inboxAccess` na leitura já garante a caixa de origem: fora do alcance,
    // a conversa simplesmente não é encontrada.
    const conversation = await repository.findById(
      session.account.id,
      conversationId,
      session.inboxAccess,
    );
    if (!conversation) {
      return fail(new DomainError('Conversa não encontrada.', 'NOT_FOUND'));
    }

    if (conversation.inboxId === targetInboxId) {
      return ok(conversation);
    }

    return ok(
      await repository.moveToInbox(session.account.id, conversationId, targetInboxId, {
        // Quem decide se o responsável fica é o alcance **dele**, não o de quem
        // move: o gestor enxerga todas as caixas e ainda assim não pode deixar
        // um agente preso a um atendimento que ele não abre.
        keepAssignee: conversation.assigneeId
          ? await repository.userReachesInbox(
              session.account.id,
              conversation.assigneeId,
              targetInboxId,
            )
          : false,
      }),
    );
  };
