import type {
  Conversation,
  ConversationFilter,
  ConversationStatus,
  Priority,
} from '../domain/conversation';
import type { Contact } from '../domain/contact';
import type { Label } from '../domain/label';
import type { Message } from '../domain/message';
import type { Id } from '../domain/shared';
import type { InboxAccess } from '../domain/user';

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
  readonly accountId: Id;
  readonly conversationId: Id;
  readonly text: string;
  readonly isPrivate: boolean;
  readonly authorId: Id;
  readonly authorName: string;
  /** Mensagem citada, quando esta é uma resposta a uma anterior. */
  readonly replyToId?: Id;
  /** Quem foi mencionado com `@`, já resolvido no servidor. */
  readonly mentions?: readonly Id[];
}

/** Leitura de conversas (ISP: quem só lista não depende de escrita). */
export interface ConversationReader {
  list(
    accountId: Id,
    currentUserId: Id,
    filter: ConversationFilter,
  ): Promise<readonly Conversation[]>;
  findById(
    accountId: Id,
    conversationId: Id,
    inboxAccess: InboxAccess,
  ): Promise<Conversation | null>;
}

/** Escrita de conversas. */
export interface ConversationWriter {
  appendMessage(input: NewMessageInput): Promise<Message>;
  /**
   * Vincula a mensagem ao id que o provedor externo devolveu.
   * Sem esse vinculo os recibos de entrega/leitura do canal não encontram
   * a mensagem na timeline e os ticks ficam congelados.
   */
  attachExternalId(
    accountId: Id,
    conversationId: Id,
    messageId: Id,
    externalId: string,
  ): Promise<void>;
  changeStatus(
    accountId: Id,
    conversationId: Id,
    status: ConversationStatus,
  ): Promise<Conversation>;
  changePriority(accountId: Id, conversationId: Id, priority: Priority): Promise<Conversation>;
  assign(accountId: Id, conversationId: Id, assignee: Assignee | null): Promise<Conversation>;
  /**
   * Move o atendimento para outra caixa de entrada.
   *
   * `keepAssignee` é decidido fora daqui, pelo caso de uso, porque é regra de
   * negócio e não de persistência: o responsável só continua se **ele** alcançar
   * a caixa de destino. Falso, a conversa volta para a fila sem dono — melhor
   * que ficar com um dono incapaz de abri-la.
   */
  moveToInbox(
    accountId: Id,
    conversationId: Id,
    targetInboxId: Id,
    options: { readonly keepAssignee: boolean },
  ): Promise<Conversation>;
  /**
   * Esta pessoa alcança esta caixa?
   *
   * Pergunta sobre **outra** pessoa, e por isso não sai da sessão de quem
   * chama: é o que decide se o responsável atual sobrevive a uma mudança de
   * caixa.
   */
  userReachesInbox(accountId: Id, userId: Id, inboxId: Id): Promise<boolean>;
  setLabels(accountId: Id, conversationId: Id, labels: readonly Label[]): Promise<Conversation>;
  /**
   * Propaga a nova versao do contato para as conversas que carregam a copia
   * dele. Sem isso, editar as etiquetas do contato deixaria a caixa de entrada
   * mostrando a versao antiga ate' o proximo carregamento completo.
   */
  syncContact(accountId: Id, contact: Contact): Promise<void>;
  /**
   * Anexa uma mensagem já montada (mídia, template) sem passar por texto puro.
   * O autor é necessário para a primeira resposta pública assumir o atendimento.
   */
  appendRichMessage(
    accountId: Id,
    conversationId: Id,
    message: Message,
    authorId: Id,
  ): Promise<Message>;
  markAsRead(accountId: Id, conversationId: Id): Promise<void>;
  /** Uma mensagem da conversa, escopada pela conta. `null` quando não existe. */
  findMessage(accountId: Id, conversationId: Id, messageId: Id): Promise<Message | null>;
  /**
   * Marca a mensagem como apagada e esvazia o conteúdo.
   *
   * A linha continua para a timeline não se recosturar sem ela, mas o conteúdo
   * sai de verdade: "apagar" que deixa o texto legível no banco não é apagar.
   */
  markMessageDeleted(
    accountId: Id,
    conversationId: Id,
    messageId: Id,
  ): Promise<Conversation | null>;
}

export interface ConversationRepository extends ConversationReader, ConversationWriter {}
