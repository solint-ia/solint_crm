import type {
  Conversation,
  ConversationFilter,
  ConversationStatus,
  Priority,
} from '@/core/domain/conversation';
import type { Contact } from '@/core/domain/contact';
import type { Label } from '@/core/domain/label';
import { previewOfMessage, type Message } from '@/core/domain/message';
import { NotFoundError, type Id } from '@/core/domain/shared';
import type {
  Assignee,
  ConversationRepository,
  NewMessageInput,
} from '@/core/ports/conversation-repository';
import { prisma, asJson } from '@/infrastructure/db/prisma';
import { CONVERSATION_INCLUDE, conversationRow } from './mappers';

const nowLabel = (): string =>
  new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const STATUS_LABELS: Readonly<Record<ConversationStatus, string>> = {
  aberta: 'Em andamento',
  pendente: 'Aguardando resposta',
  resolvida: 'Encerrada',
  espera: 'Em espera',
};

export class PrismaConversationRepository implements ConversationRepository {
  async list(
    accountId: Id,
    _currentUserId: Id,
    _filter: ConversationFilter,
  ): Promise<readonly Conversation[]> {
    // A filtragem fina vive no domínio (`matchesScope`, filtros da caixa) e é
    // aplicada sobre esta lista. Ordenar aqui garante que a caixa já chegue na
    // ordem certa mesmo antes de o cliente reordenar.
    const rows = await prisma.conversation.findMany({
      where: { accountId },
      include: CONVERSATION_INCLUDE,
      orderBy: { lastActivityAt: 'desc' },
    });
    return rows.map(conversationRow);
  }

  async findById(accountId: Id, conversationId: Id): Promise<Conversation | null> {
    const row = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      include: CONVERSATION_INCLUDE,
    });
    return row ? conversationRow(row) : null;
  }

  async appendMessage(input: NewMessageInput): Promise<Message> {
    const message: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: input.conversationId,
      author: 'agent',
      authorName: input.authorName,
      content: { type: 'text', text: input.text },
      time: nowLabel(),
      isPrivate: input.isPrivate,
      origin: 'crm',
      ...(input.isPrivate ? {} : { deliveryStatus: 'enviando' as const }),
    };
    return this.persistMessage(input.accountId, input.conversationId, message);
  }

  async appendRichMessage(accountId: Id, conversationId: Id, message: Message): Promise<Message> {
    return this.persistMessage(accountId, conversationId, message);
  }

  /**
   * Grava a mensagem e atualiza o resumo da conversa numa transação.
   *
   * As duas escritas precisam andar juntas: uma mensagem gravada sem atualizar
   * `lastActivityAt` sumiria do topo da caixa de entrada, e um resumo
   * atualizado sem a mensagem prometeria um texto que não existe na timeline.
   */
  private async persistMessage(
    accountId: Id,
    conversationId: Id,
    message: Message,
  ): Promise<Message> {
    const exists = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      select: { id: true, lastMessagePreview: true },
    });
    if (!exists) throw new NotFoundError('Conversa', conversationId);

    await prisma.$transaction([
      prisma.message.create({
        data: {
          id: message.id,
          conversationId,
          author: message.author,
          authorName: message.authorName ?? null,
          contentType: message.content.type,
          content: asJson(message.content),
          time: message.time,
          deliveryStatus: message.deliveryStatus ?? null,
          isPrivate: message.isPrivate,
          replyToId: message.replyToId ?? null,
          externalId: message.externalId ?? null,
          origin: message.origin ?? null,
        },
      }),
      prisma.conversation.update({
        where: { id: conversationId, accountId },
        data: {
          lastMessagePreview: message.isPrivate
            ? exists.lastMessagePreview
            : previewOfMessage(message),
          lastMessageAt: message.time,
          lastActivityAt: new Date(),
        },
      }),
    ]);

    return message;
  }

  async attachExternalId(
    accountId: Id,
    conversationId: Id,
    messageId: Id,
    externalId: string,
  ): Promise<void> {
    // `conversation: { accountId }` e nao um `assert` antes: a posse e condicao
    // do proprio UPDATE. Um id de outra conta simplesmente nao casa nenhuma
    // linha, e nada acontece.
    await prisma.message.updateMany({
      where: { id: messageId, conversationId, conversation: { accountId } },
      data: { externalId, deliveryStatus: 'enviado' },
    });
  }

  async changeStatus(
    accountId: Id,
    conversationId: Id,
    status: ConversationStatus,
  ): Promise<Conversation> {
    return this.patch(accountId, conversationId, {
      status,
      statusLabel: STATUS_LABELS[status],
    });
  }

  async changePriority(
    accountId: Id,
    conversationId: Id,
    priority: Priority,
  ): Promise<Conversation> {
    return this.patch(accountId, conversationId, { priority });
  }

  async assign(
    accountId: Id,
    conversationId: Id,
    assignee: Assignee | null,
  ): Promise<Conversation> {
    return this.patch(accountId, conversationId, {
      assigneeId: assignee?.id ?? null,
      assigneeName: assignee?.name ?? null,
    });
  }

  async setLabels(
    accountId: Id,
    conversationId: Id,
    labels: readonly Label[],
  ): Promise<Conversation> {
    // `set` substitui o vínculo inteiro — é a operação que a tela faz: o
    // cliente manda o conjunto final, não um delta.
    return this.patch(accountId, conversationId, {
      labels: { set: labels.map((label) => ({ id: label.id })) },
    });
  }

  async markAsRead(accountId: Id, conversationId: Id): Promise<void> {
    await prisma.conversation.updateMany({
      where: { id: conversationId, accountId },
      data: { unreadCount: 0 },
    });
  }

  async syncContact(accountId: Id, contact: Contact): Promise<void> {
    // O contato é uma relação, não uma cópia: gravar o contato já basta para
    // toda conversa dele enxergar a versão nova na próxima leitura.
    await prisma.contact.updateMany({
      where: { id: contact.id, accountId },
      data: { name: contact.name, avatarUrl: contact.avatarUrl ?? null },
    });
  }

  private async patch(
    accountId: Id,
    conversationId: Id,
    // O tipo aberto é intencional: o `patch` aceita tanto colunas quanto
    // operações de relação do Prisma (`labels: { set: [...] }`).
    data: Record<string, unknown>,
  ): Promise<Conversation> {
    const exists = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Conversa', conversationId);

    const row = await prisma.conversation.update({
      where: { id: conversationId, accountId },
      data,
      include: CONVERSATION_INCLUDE,
    });
    return conversationRow(row);
  }
}
