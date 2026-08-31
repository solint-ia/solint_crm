import type { WhatsAppTemplate } from '../domain/campaign';
import { renderTemplate } from '../domain/campaign';
import type { Message, MessageContent } from '../domain/message';
import { DomainError, fail, ok, type Id, type Result } from '../domain/shared';
import { can, type Session } from '../domain/user';
import type { ConversationRepository } from '../ports/conversation-repository';
import { horaLabel } from '@/lib/datetime';

const nowLabel = (): string => horaLabel(new Date());

const newId = (): Id => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export interface SendTemplateInput {
  readonly session: Session;
  readonly conversationId: Id;
  readonly template: WhatsAppTemplate;
  readonly values: readonly string[];
}

/**
 * Envio de template HSM.
 *
 * É o único caminho permitido fora da janela de 24h — e é por isso que ele não
 * chama `canSendFreeText`. O banner que bloqueia o composer mandava "envie um
 * template aprovado" sem oferecer nenhum: era um beco sem saída, e este caso de
 * uso é a saída.
 *
 * Template não aprovado é recusado aqui, não na tela: a Meta rejeitaria o envio
 * de qualquer forma, e falhar depois de gravar deixaria a timeline mentindo.
 */
export const createSendTemplate =
  (repository: ConversationRepository) =>
    async ({
      session,
      conversationId,
      template,
      values,
    }: SendTemplateInput): Promise<Result<Message>> => {
      if (!can(session, 'conversas:responder')) {
        return fail(new DomainError('Sem permissão para responder conversas.', 'FORBIDDEN'));
      }
      if (template.approval !== 'aprovado') {
        return fail(
          new DomainError(
            `O template "${template.name}" ainda não foi aprovado e não pode ser enviado.`,
            'TEMPLATE_NOT_APPROVED',
          ),
        );
      }

      const missing = template.variables.findIndex((_, index) => !values[index]?.trim());
      if (missing >= 0) {
        return fail(
          new DomainError(
            `Preencha a variável "${template.variables[missing]}" antes de enviar.`,
            'TEMPLATE_VARIABLE_MISSING',
          ),
        );
      }

      const conversation = await repository.findById(session.account.id, conversationId, session.inboxAccess);
      if (!conversation) return fail(new DomainError('Conversa não encontrada.', 'NOT_FOUND'));

      const message: Message = {
        id: newId(),
        conversationId,
        author: 'agent',
        authorName: session.user.name,
        origin: 'crm',
        content: {
          type: 'template',
          templateName: template.name,
          text: renderTemplate(template.body, values),
        },
        time: nowLabel(),
        isPrivate: false,
        deliveryStatus: 'enviando',
      };

      return ok(await repository.appendRichMessage(session.account.id, conversationId, message));
    };

export interface SendMediaInput {
  readonly session: Session;
  readonly conversationId: Id;
  readonly content: MessageContent;
  readonly isPrivate: boolean;
}

/**
 * Anexo de saída: imagem, vídeo, áudio, documento ou figurinha.
 *
 * A regra da janela HSM vale aqui igual ao texto livre — uma foto fora das 24h
 * é tão bloqueada quanto uma frase. Quem já montou o conteúdo é o adaptador,
 * porque só ele sabe onde o arquivo ficou guardado.
 */
export const createSendMedia =
  (repository: ConversationRepository) =>
    async ({
      session,
      conversationId,
      content,
      isPrivate,
    }: SendMediaInput): Promise<Result<Message>> => {
      if (!can(session, 'conversas:responder')) {
        return fail(new DomainError('Sem permissão para responder conversas.', 'FORBIDDEN'));
      }

      const conversation = await repository.findById(session.account.id, conversationId, session.inboxAccess);
      if (!conversation) return fail(new DomainError('Conversa não encontrada.', 'NOT_FOUND'));

      const message: Message = {
        id: newId(),
        conversationId,
        author: 'agent',
        authorName: session.user.name,
        origin: 'crm',
        content,
        time: nowLabel(),
        isPrivate,
        deliveryStatus: isPrivate ? undefined : 'enviando',
      };

      return ok(await repository.appendRichMessage(session.account.id, conversationId, message));
    };
