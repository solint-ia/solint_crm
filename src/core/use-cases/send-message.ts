import { isHsmWindowOpen, type Conversation } from '../domain/conversation';
import type { Message } from '../domain/message';
import { DomainError, fail, ok, type Id, type Result } from '../domain/shared';
import { can, type Session } from '../domain/user';
import type { ConversationRepository } from '../ports/conversation-repository';

export interface SendMessageInput {
  readonly session: Session;
  readonly conversationId: Id;
  readonly text: string;
  readonly isPrivate: boolean;
}

export const MAX_MESSAGE_LENGTH = 4096;

/**
 * Envia mensagem publica ou registra nota interna.
 * Regras aplicadas (REGRAS-GLOBAIS.md secao 4):
 *  1. exige permissao conversas:responder;
 *  2. nota interna nunca sai para o canal externo;
 *  3. fora da janela HSM de 24h no WhatsApp, texto livre e bloqueado.
 */
export const createSendMessage =
  (repository: ConversationRepository) =>
  async ({
    session,
    conversationId,
    text,
    isPrivate,
  }: SendMessageInput): Promise<Result<Message>> => {
    if (!can(session, 'conversas:responder')) {
      return fail(new DomainError('Sem permissão para responder conversas.', 'FORBIDDEN'));
    }

    const content = text.trim();
    if (!content) {
      return fail(new DomainError('A mensagem não pode estar vazia.', 'EMPTY_MESSAGE'));
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      return fail(new DomainError('A mensagem excede o limite de caracteres.', 'MESSAGE_TOO_LONG'));
    }

    const conversation = await repository.findById(session.account.id, conversationId);
    if (!conversation) {
      return fail(new DomainError('Conversa não encontrada.', 'NOT_FOUND'));
    }

    if (!isPrivate && !canSendFreeText(conversation)) {
      return fail(
        new DomainError(
          'Janela de 24h encerrada: envie um template aprovado para reabrir a conversa.',
          'HSM_WINDOW_CLOSED',
        ),
      );
    }

    const message = await repository.appendMessage({
      accountId: session.account.id,
      conversationId,
      text: content,
      isPrivate,
      authorId: session.user.id,
      authorName: session.user.name,
    });

    return ok(message);
  };

export const canSendFreeText = (conversation: Conversation): boolean =>
  isHsmWindowOpen(conversation);
