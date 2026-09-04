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
import type { InboxAccess } from '@/core/domain/user';
import type {
  Assignee,
  ConversationRepository,
  NewMessageInput,
} from '@/core/ports/conversation-repository';
import { normalizeBusinessHours } from '@/core/domain/business-hours';
import { calcularSla } from '@/core/domain/sla';
import { prisma, asJson } from '@/infrastructure/db/prisma';
import { waEventBus } from '@/infrastructure/whatsapp/whatsapp-events';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { horaLabel } from '@/lib/datetime';
import { CONVERSATION_INCLUDE, conversationRow, messageRow } from './mappers';

const nowLabel = (): string => horaLabel(new Date());

const STATUS_LABELS: Readonly<Record<ConversationStatus, string>> = {
  aberta: 'Em andamento',
  pendente: 'Aguardando resposta',
  resolvida: 'Encerrada',
  espera: 'Em espera',
};

/**
 * Recorte por caixa de entrada, em SQL.
 *
 * Filtrar em memória depois de carregar tudo funcionaria e seria errado por
 * dois motivos: traria do banco conversa que quem pediu não pode ver — e basta
 * um `console.log` distraído para ela aparecer — e carregaria a timeline inteira
 * de cada uma para depois jogar fora.
 *
 * Lista vazia devolve `in: []`, que não casa com nada. É o resultado correto
 * para quem não participa de nenhuma equipe: não vê conversa nenhuma.
 */
const inboxScope = (access: InboxAccess) =>
  access === 'todas' ? {} : { inboxId: { in: [...access] } };

export class PrismaConversationRepository implements ConversationRepository {
  async list(
    accountId: Id,
    _currentUserId: Id,
    filter: ConversationFilter,
  ): Promise<readonly Conversation[]> {
    // A filtragem fina vive no domínio (`matchesScope`, filtros da caixa) e é
    // aplicada sobre esta lista. Ordenar aqui garante que a caixa já chegue na
    // ordem certa mesmo antes de o cliente reordenar. O recorte por caixa é a
    // exceção: é autorização, e autorização não se aplica depois.
    const rows = await prisma.conversation.findMany({
      where: { accountId, ...inboxScope(filter.inboxAccess) },
      include: CONVERSATION_INCLUDE,
      orderBy: { lastActivityAt: 'desc' },
    });
    return rows.map(conversationRow);
  }

  /**
   * Uma conversa pelo id.
   *
   * O `inboxAccess` não é enfeite: esta é a consulta que atende
   * `/conversas/[id]`, e sem ela bastaria digitar o id na URL para abrir o
   * atendimento de um setor a que a pessoa não tem acesso. Fora do alcance,
   * responde `null` — e a tela mostra 404, que é a resposta certa: existir ou
   * não existir é informação que ela também não deveria ter.
   */
  async findById(
    accountId: Id,
    conversationId: Id,
    inboxAccess: InboxAccess,
  ): Promise<Conversation | null> {
    const row = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId, ...inboxScope(inboxAccess) },
      include: CONVERSATION_INCLUDE,
    });
    return row ? conversationRow(row) : null;
  }

  async appendMessage(input: NewMessageInput): Promise<Message> {
    const message: Message = {
      id: input.messageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: input.conversationId,
      author: 'agent',
      authorName: input.authorName,
      content: { type: 'text', text: input.text },
      time: nowLabel(),
      isPrivate: input.isPrivate,
      origin: 'crm',
      ...(input.replyToId ? { replyToId: input.replyToId } : {}),
      ...(input.mentions?.length ? { mentions: input.mentions } : {}),
      ...(input.isPrivate ? {} : { deliveryStatus: 'enviando' as const }),
    };
    return this.persistMessage(
      input.accountId,
      input.conversationId,
      message,
      input.authorId,
      input.idempotencyKey,
    );
  }

  async appendRichMessage(
    accountId: Id,
    conversationId: Id,
    message: Message,
    authorId: Id,
  ): Promise<Message> {
    return this.persistMessage(accountId, conversationId, message, authorId);
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
    authorId: Id,
    idempotencyKey?: string,
  ): Promise<Message> {
    const exists = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      select: {
        id: true,
        lastMessagePreview: true,
        createdAt: true,
        firstResponseAt: true,
        assigneeId: true,
        inboxId: true,
        inbox: { select: { businessHours: true } },
      },
    });
    if (!exists) throw new NotFoundError('Conversa', conversationId);

    const agora = new Date();

    /**
     * O tempo de primeira resposta se carimba aqui, no único ponto por onde
     * toda resposta de atendente passa.
     *
     * Antes o painel imprimia `'1m 15s'` — uma constante escrita no código,
     * igual para toda conta e todo período. Não havia de onde tirar o valor
     * real: nada guardava **quando** a conversa foi respondida pela primeira
     * vez.
     *
     * Duas exclusões, e as duas mudam o número de verdade. **Nota interna** não
     * conta: o cliente não a recebe, e ele continua esperando. **Mensagem
     * automática** também não — ela entra como `system`, sai em dois segundos, e
     * uma saudação faria o indicador da equipe inteira marcar zero.
     *
     * A contagem começa na primeira mensagem **do contato**, não na criação da
     * conversa. Uma conversa aberta por nós (campanha, retomada de contato)
     * nasce com uma mensagem nossa: medida contra `createdAt`, ela registraria
     * uma primeira resposta de zero segundo para um cliente que ainda nem
     * tinha escrito. Sem mensagem do contato não há espera a medir, e o campo
     * fica nulo — que é diferente de zero.
     */
    let primeiraResposta: {
      firstResponseAt?: Date;
      firstResponseSecs?: number;
    } = {};

    if (message.author === 'agent' && !message.isPrivate && !exists.firstResponseAt) {
      const primeiraDoContato = await prisma.message.findFirst({
        where: { conversationId, author: 'contact', isPrivate: false },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });

      if (primeiraDoContato) {
        primeiraResposta = {
          firstResponseAt: agora,
          firstResponseSecs: Math.max(
            0,
            Math.round((agora.getTime() - primeiraDoContato.createdAt.getTime()) / 1000),
          ),
        };
      }
    }

    /**
     * O relógio do prazo de resposta, no mesmo ponto único.
     *
     * Mensagem do **contato** arma o prazo; resposta pública do atendente o
     * desarma. Nota interna não mexe em nada: o cliente não a recebe e continua
     * esperando.
     *
     * Só o contato reinicia o relógio, e a primeira resposta de um atendimento
     * tem prazo mais curto que as seguintes — quem ainda não foi atendido é
     * quem mais corre risco de desistir.
     */
    let sla: {
      slaDeadlineAt?: string | null;
      slaLabel?: string | null;
      slaBreached?: boolean | null;
    } = {};

    if (message.author === 'contact' && !message.isPrivate) {
      const hours = normalizeBusinessHours(exists.inbox?.businessHours);
      sla = calcularSla(agora, !exists.firstResponseAt, hours, agora);
    } else if (message.author === 'agent' && !message.isPrivate) {
      sla = { slaDeadlineAt: null, slaLabel: null, slaBreached: null };
    }

    const assumiuAtendimento = await prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          id: message.id,
          conversationId,
          author: message.author,
          authorId: message.author === 'agent' ? authorId : null,
          authorName: message.authorName ?? null,
          contentType: message.content.type,
          content: asJson(message.content),
          time: message.time,
          createdAt: agora,
          deliveryStatus: message.deliveryStatus ?? null,
          isPrivate: message.isPrivate,
          replyToId: message.replyToId ?? null,
          externalId: message.externalId ?? null,
          origin: message.origin ?? null,
          mentions: asJson(message.mentions ?? []),
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await tx.conversation.update({
        where: { id: conversationId, accountId },
        data: {
          lastMessagePreview: message.isPrivate
            ? exists.lastMessagePreview
            : previewOfMessage(message),
          lastMessageAt: message.time,
          lastActivityAt: agora,
          ...primeiraResposta,
          ...sla,
        },
      });

      if (message.author !== 'agent' || message.isPrivate || exists.assigneeId) return false;

      /**
       * Compare-and-set: somente a conversa ainda sem responsável pode ser
       * assumida. Se dois agentes responderem juntos, o segundo UPDATE espera
       * o primeiro terminar e reavalia `assigneeId: null`; por isso ele não
       * rouba a conversa que o primeiro acabou de assumir.
       */
      const claimed = await tx.conversation.updateMany({
        where: { id: conversationId, accountId, assigneeId: null },
        data: { assigneeId: authorId, assigneeName: message.authorName ?? null },
      });
      return claimed.count === 1;
    });

    if (assumiuAtendimento) {
      void writeAuditLog({
        accountId,
        actorId: authorId,
        actorName: message.authorName ?? 'Atendente',
        action: 'conversa.responsavel',
        targetType: 'conversa',
        targetId: conversationId,
      });
      try {
        const conversation = waEventBus.hasConversationListeners
          ? await this.findById(accountId, conversationId, 'todas')
          : null;
        waEventBus.emitConversation({
          type: 'conversation_updated',
          accountId,
          conversationId,
          inboxId: exists.inboxId,
          ...(conversation ? { conversation } : {}),
        });
      } catch (error) {
        // O atendimento já foi assumido e a mensagem já está gravada. Uma
        // falha no aviso em tempo real não pode transformar esse sucesso em erro.
        console.warn('[ConversationRepository] Falha ao anunciar auto-posse:', error);
      }
    }

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
      data: { externalId, deliveryStatus: 'enviado', dispatchError: null },
    });
  }

  /**
   * Muda o status e carimba o instante da resolução.
   *
   * `resolvedAt` é o que torna o "tempo de resolução" do painel um número em
   * vez de uma constante: sem ele, só dá para saber que a conversa **está**
   * resolvida, nunca há quanto tempo nem depois de quanto tempo. Reabrir limpa
   * as duas marcas -- uma conversa aberta que carregasse o tempo da resolução
   * anterior entraria na média duas vezes, com o valor errado nas duas.
   */
  async changeStatus(
    accountId: Id,
    conversationId: Id,
    status: ConversationStatus,
  ): Promise<Conversation> {
    const atual = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      select: { createdAt: true, status: true },
    });

    const agora = new Date();
    const marcas =
      status === 'resolvida'
        ? {
            resolvedAt: agora,
            resolutionSecs: atual
              ? Math.max(0, Math.round((agora.getTime() - atual.createdAt.getTime()) / 1000))
              : null,
          }
        : atual?.status === 'resolvida'
          ? { resolvedAt: null, resolutionSecs: null }
          : {};

    return this.patch(accountId, conversationId, {
      status,
      statusLabel: STATUS_LABELS[status],
      ...marcas,
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

  async moveToInbox(
    accountId: Id,
    conversationId: Id,
    targetInboxId: Id,
    options: { readonly keepAssignee: boolean },
  ): Promise<Conversation> {
    // A caixa de destino precisa ser desta conta. Sem esta conferência, um id
    // de caixa de outra empresa moveria a conversa para fora do inquilino — ela
    // sumiria da tela de todo mundo aqui e apareceria na de lá.
    const inbox = await prisma.inbox.findFirst({
      where: { id: targetInboxId, accountId },
      select: { id: true },
    });
    if (!inbox) throw new NotFoundError('Caixa de entrada', targetInboxId);

    return this.patch(accountId, conversationId, {
      inboxId: targetInboxId,
      ...(options.keepAssignee ? {} : { assigneeId: null, assigneeName: null }),
    });
  }

  async userReachesInbox(accountId: Id, userId: Id, inboxId: Id): Promise<boolean> {
    // Papel com `caixas:todas` alcança tudo, e é preciso perguntar isso pelo
    // vínculo desta conta: o papel da pessoa em outra empresa não vale aqui.
    const membership = await prisma.membership.findUnique({
      where: { userId_accountId: { userId, accountId } },
      select: { roleSlug: true },
    });
    if (!membership) return false;

    const role = await prisma.role.findUnique({
      where: { accountId_slug: { accountId, slug: membership.roleSlug } },
      select: { permissions: true },
    });
    const permissions = Array.isArray(role?.permissions) ? (role.permissions as string[]) : [];
    if (permissions.includes('caixas:todas')) return true;

    // Conta sem equipe com caixa vinculada não restringe ninguém — a mesma
    // regra que `resolveInboxAccess` aplica na sessão. Divergir aqui faria a
    // conversa perder o dono numa conta que sequer usa equipes.
    const comCaixa = await prisma.team.count({
      where: { accountId, teamInboxes: { some: {} } },
    });
    if (comCaixa === 0) return true;

    const alcance = await prisma.team.count({
      where: {
        accountId,
        teamMembers: { some: { userId } },
        teamInboxes: { some: { inboxId } },
      },
    });
    return alcance > 0;
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

  async findMessage(accountId: Id, conversationId: Id, messageId: Id): Promise<Message | null> {
    // A conta entra pela relação, como em `attachExternalId`: um id de outra
    // conta não casa linha nenhuma e responde "não existe", que é a resposta
    // certa — inclusive para quem estiver sondando ids.
    const row = await prisma.message.findFirst({
      where: { id: messageId, conversationId, conversation: { accountId } },
    });
    return row ? messageRow(row) : null;
  }

  async markMessageDeleted(
    accountId: Id,
    conversationId: Id,
    messageId: Id,
  ): Promise<Conversation | null> {
    const { count } = await prisma.message.updateMany({
      where: { id: messageId, conversationId, conversation: { accountId }, deletedAt: null },
      data: {
        deletedAt: new Date(),
        // O conteúdo sai de verdade. Guardar o texto original numa linha
        // marcada como apagada seria manter, no banco e em toda API que lê
        // mensagens, exatamente aquilo que alguém pediu para remover.
        contentType: 'text',
        content: asJson({ type: 'text', text: '' }),
      },
    });
    if (count === 0) return null;

    /**
     * O resumo da conversa é refeito quando a apagada era a última.
     *
     * `lastMessagePreview` é uma cópia do texto, e ela não se atualiza sozinha:
     * sem isto, a lista de conversas continuaria exibindo o trecho da mensagem
     * que acabou de ser apagada — o texto sobrevivendo justamente no lugar mais
     * visível do produto.
     */
    const ultima = await prisma.message.findFirst({
      where: { conversationId, isPrivate: false },
      orderBy: { createdAt: 'desc' },
    });
    if (ultima) {
      await prisma.conversation.updateMany({
        where: { id: conversationId, accountId },
        data: { lastMessagePreview: previewOfMessage(messageRow(ultima)) },
      });
    }

    return this.findById(accountId, conversationId, 'todas');
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
