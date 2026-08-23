import type { Conversation, Priority } from '../domain/conversation';
import type { Label } from '../domain/label';
import { DomainError, fail, ok, type Id, type Result } from '../domain/shared';
import { can, type Session } from '../domain/user';
import type { Assignee, ConversationWriter } from '../ports/conversation-repository';

/**
 * Triagem: quem atende, com que urgência, e sob que etiquetas.
 *
 * As três operações moram no mesmo arquivo porque compartilham a mesma
 * pergunta de autorização — mexer no roteamento de uma conversa — e porque o
 * repositório já sabia fazê-las: faltava só o caso de uso que decide quem pode.
 */

export interface AssignConversationInput {
  readonly session: Session;
  readonly conversationId: Id;
  /** `null` devolve a conversa para a fila geral. */
  readonly assignee: Assignee | null;
}

export const createAssignConversation =
  (repository: ConversationWriter) =>
  async ({
    session,
    conversationId,
    assignee,
  }: AssignConversationInput): Promise<Result<Conversation>> => {
    if (!can(session, 'conversas:transferir')) {
      return fail(new DomainError('Sem permissão para transferir atendimentos.', 'FORBIDDEN'));
    }
    return ok(await repository.assign(session.account.id, conversationId, assignee));
  };

export interface ChangePriorityInput {
  readonly session: Session;
  readonly conversationId: Id;
  readonly priority: Priority;
}

export const createChangeConversationPriority =
  (repository: ConversationWriter) =>
  async ({
    session,
    conversationId,
    priority,
  }: ChangePriorityInput): Promise<Result<Conversation>> => {
    if (!can(session, 'conversas:responder')) {
      return fail(new DomainError('Sem permissão para alterar a prioridade.', 'FORBIDDEN'));
    }
    return ok(await repository.changePriority(session.account.id, conversationId, priority));
  };

export interface SetLabelsInput {
  readonly session: Session;
  readonly conversationId: Id;
  readonly labels: readonly Label[];
}

export const createSetConversationLabels =
  (repository: ConversationWriter) =>
  async ({ session, conversationId, labels }: SetLabelsInput): Promise<Result<Conversation>> => {
    if (!can(session, 'conversas:responder')) {
      return fail(new DomainError('Sem permissão para etiquetar conversas.', 'FORBIDDEN'));
    }
    return ok(await repository.setLabels(session.account.id, conversationId, labels));
  };
