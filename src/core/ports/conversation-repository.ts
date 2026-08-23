import type { Conversation, ConversationFilter, ConversationStatus, Priority } from '../domain/conversation';
import type { Contact } from '../domain/contact';
import type { Label } from '../domain/label';
import type { Message } from '../domain/message';
import type { Id } from '../domain/shared';

/**
 * Responsável pelo atendimento.
 *
 * Carrega o nome junto com o id de propósito: a implementação anterior recebia
 * só o id e gravava `assigneeName: undefined`, então transferir uma conversa
 * apagava o nome do responsável na lista. Quem atribui é quem sabe o nome.
 */
export interface Assignee {
  readonly id: Id;
  readonly name: string;
}

export interface NewMessageInput {
  readonly conversationId: Id;
  readonly text: string;
  readonly isPrivate: boolean;
  readonly authorId: Id;
  readonly authorName: string;
}

/** Leitura de conversas (ISP: quem só lista não depende de escrita). */
export interface ConversationReader {
  list(accountId: Id, currentUserId: Id, filter: ConversationFilter): Promise<readonly Conversation[]>;
  findById(accountId: Id, conversationId: Id): Promise<Conversation | null>;
}

/** Escrita de conversas. */
export interface ConversationWriter {
  appendMessage(input: NewMessageInput): Promise<Message>;
  /**
   * Vincula a mensagem ao id que o provedor externo devolveu.
   * Sem esse vinculo os recibos de entrega/leitura do canal não encontram
   * a mensagem na timeline e os ticks ficam congelados.
   */
  attachExternalId(conversationId: Id, messageId: Id, externalId: string): Promise<void>;
  changeStatus(accountId: Id, conversationId: Id, status: ConversationStatus): Promise<Conversation>;
  changePriority(accountId: Id, conversationId: Id, priority: Priority): Promise<Conversation>;
  assign(accountId: Id, conversationId: Id, assignee: Assignee | null): Promise<Conversation>;
  setLabels(accountId: Id, conversationId: Id, labels: readonly Label[]): Promise<Conversation>;
  /**
   * Propaga a nova versao do contato para as conversas que carregam a copia
   * dele. Sem isso, editar as etiquetas do contato deixaria a caixa de entrada
   * mostrando a versao antiga ate' o proximo carregamento completo.
   */
  syncContact(accountId: Id, contact: Contact): Promise<void>;
  /** Anexa uma mensagem já montada (mídia, template) sem passar por texto puro. */
  appendRichMessage(conversationId: Id, message: Message): Promise<Message>;
  markAsRead(accountId: Id, conversationId: Id): Promise<void>;
}

export interface ConversationRepository extends ConversationReader, ConversationWriter {}
