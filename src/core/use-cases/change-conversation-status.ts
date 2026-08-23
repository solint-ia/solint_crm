import type { Conversation, ConversationStatus } from '../domain/conversation';
import { DomainError, fail, ok, type Id, type Result } from '../domain/shared';
import { can, type Session } from '../domain/user';
import type { ConversationWriter } from '../ports/conversation-repository';

export interface ChangeConversationStatusInput {
  readonly session: Session;
  readonly conversationId: Id;
  readonly status: ConversationStatus;
}

export const createChangeConversationStatus =
  (repository: ConversationWriter) =>
  async ({
    session,
    conversationId,
    status,
  }: ChangeConversationStatusInput): Promise<Result<Conversation>> => {
    const permission = status === 'resolvida' ? 'conversas:resolver' : 'conversas:responder';
    if (!can(session, permission)) {
      return fail(new DomainError('Sem permissão para alterar o status.', 'FORBIDDEN'));
    }
    const conversation = await repository.changeStatus(session.account.id, conversationId, status);
    return ok(conversation);
  };
