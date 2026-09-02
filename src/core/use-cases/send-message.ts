import { isHsmWindowOpen, type Conversation } from '../domain/conversation';
import { extractMentions, type MentionCandidate } from '../domain/mentions';
import type { Message } from '../domain/message';
import { DomainError, fail, ok, type Id, type Result } from '../domain/shared';
import { can, type Session } from '../domain/user';
import type { ConversationRepository } from '../ports/conversation-repository';

export interface SendMessageInput {
  readonly session: Session;
  readonly conversationId: Id;
  readonly text: string;
  readonly isPrivate: boolean;
  /**
   * Quem pode ser mencionado com `@` numa nota interna.
   *
   * A lista chega de fora — é a Server Action que conhece os membros da conta —
   * e a resolução acontece **aqui**, nunca no cliente: quem enviasse a lista
   * pronta poderia notificar qualquer pessoa da conta sem escrever o nome dela
   * em lugar nenhum.
   */
  readonly mentionCandidates?: readonly MentionCandidate[];
}

export const MAX_MESSAGE_LENGTH = 4096;

/**
 * A conversa acompanha a mensagem no retorno.
 *
 * Ela já foi carregada aqui dentro para a checagem da janela HSM, e quem chama
 * precisa dela em seguida para saber para onde despachar (`channelThreadId`,
 * telefone do contato). Devolvê-la evita que a Server Action repita a mesma
 * consulta — que não é barata: traz a timeline junto.
 *
 * É o retrato **anterior** ao envio: a mensagem nova não está na timeline dela.
 * Serve para decidir o despacho, não para publicar como estado da conversa.
 */
export interface SendMessageOutput {
  readonly message: Message;
  readonly conversation: Conversation;
}

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
    mentionCandidates = [],
  }: SendMessageInput): Promise<Result<SendMessageOutput>> => {
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

    const conversation = await repository.findById(session.account.id, conversationId, session.inboxAccess);
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

    /**
     * Menção só existe em nota interna.
     *
     * Numa mensagem pública, `@Ana` é texto que o **cliente** vai ler: tratá-lo
     * como menção acenderia o sininho de alguém por causa de uma frase que não
     * era dirigida à equipe.
     */
    const mentions =
      isPrivate && mentionCandidates.length > 0
        ? extractMentions(content, mentionCandidates)
        : [];

    const message = await repository.appendMessage({
      accountId: session.account.id,
      conversationId,
      text: content,
      isPrivate,
      authorId: session.user.id,
      authorName: session.user.name,
      ...(mentions.length > 0 ? { mentions } : {}),
    });

    return ok({ message, conversation });
  };

export const canSendFreeText = (conversation: Conversation): boolean =>
  isHsmWindowOpen(conversation);
