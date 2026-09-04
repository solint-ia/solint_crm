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

export interface SetAiPauseInput {
  readonly session: Session;
  readonly conversationId: Id;
  /** `true` tira o agente da conversa; `false` o devolve antes do prazo. */
  readonly paused: boolean;
}

/**
 * Cala o agente de IA nesta conversa, ou o traz de volta.
 *
 * A permissão exigida é a de **responder**, e não a de transferir: quem pode
 * escrever para o cliente é exatamente quem precisa poder assumir a conversa
 * das mãos do agente. Pedir a permissão de transferência excluiria o atendente
 * comum justamente do caso que o botão existe para resolver.
 *
 * Pausar carimba quem pausou, para a tela poder dizer de quem é a conversa
 * agora. Despausar não carimba ninguém: o campo volta a vazio, que é o estado
 * "o agente responde".
 */
export const createSetAiPause =
  (repository: ConversationWriter) =>
  async ({ session, conversationId, paused }: SetAiPauseInput): Promise<Result<Conversation>> => {
    if (!can(session, 'conversas:responder')) {
      return fail(new DomainError('Sem permissão para pausar o agente.', 'FORBIDDEN'));
    }
    if (!paused) {
      return ok(await repository.resumeAiAgent(session.account.id, conversationId));
    }
    return ok(
      await repository.pauseAiAgent(session.account.id, conversationId, 'manual', {
        id: session.user.id,
        name: session.user.name,
      }),
    );
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
