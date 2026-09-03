import type { Contact } from '@/core/domain/contact';
import type { Conversation } from '@/core/domain/conversation';
import type { Message, MessageReaction } from '@/core/domain/message';
import { Prisma } from '@/generated/prisma';
import { prisma, asJson } from '@/infrastructure/db/prisma';
import {
  CONVERSATION_INCLUDE,
  contactRow,
  conversationRow,
} from '@/infrastructure/repositories/prisma/mappers';
import { dispararAutomacoes } from '@/infrastructure/automations/dispatch';
import { dispararWebhooks, mensagemDoPayload } from '@/infrastructure/webhooks/webhook-dispatch';
import type { ChatIdentity } from './wa-identity';
import type { AdContext } from './wa-message-content';
import { waEventBus } from './whatsapp-events';
import { normalizeBusinessHours } from '@/core/domain/business-hours';
import { calcularSla } from '@/core/domain/sla';
import { novoProtocolo } from '@/infrastructure/conversations/protocols';

/**
 * Persistência das mensagens que chegam do WhatsApp.
 *
 * Ficou separada do `whatsapp-service` de propósito: o serviço cuida do
 * protocolo (socket, chaves, mídia cifrada) e este módulo cuida do banco. Antes
 * o serviço mexia direto num array em memória, o que deixava toda mensagem real
 * recebida se perder no primeiro reinício.
 *
 * **Toda função aqui recebe `accountId`.** Antes ele vinha de uma constante
 * importada do seed, e o efeito era que toda mensagem real recebida era gravada
 * na conta de demonstração — qualquer que fosse a conta de quem conectou. Agora
 * a conta vem de quem pareou o número (ver `wa-owner.ts`), e na Fase 3 passa a
 * vir da `Inbox`, que é onde ela pertence quando há mais de uma conexão.
 */

const nowIso = (date: Date): string => date.toISOString();

/**
 * Violação de restrição única (`P2002`).
 *
 * Aparece o tempo todo neste arquivo por um motivo estrutural: as mensagens
 * recebidas são processadas **em paralelo**. O handler de `messages.upsert` é
 * assíncrono e o emissor de eventos do Baileys não o aguarda, então uma fila
 * represada dispara dezenas de gravações concorrentes. Toda leitura seguida de
 * escrita aqui tem uma janela entre as duas, e sob concorrência essa janela é
 * atingida — não raramente, mas com frequência.
 */
const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Traduz os ids sugeridos pela identidade do chat para os ids que esta conta
 * realmente usa.
 *
 * Existe por causa da chave primária global. Os ids do WhatsApp passaram a ser
 * escopados por conta (`cv-wa-<conta>-<numero>`), mas as conversas criadas
 * antes disso têm o formato antigo (`cv-wa-<numero>`), e uma mensagem nova de
 * um contato antigo não pode abrir uma segunda conversa ao lado da que já
 * existe. Reescrever os ids antigos resolveria também, ao custo de uma
 * migração que toca `Message`, `Conversation` e `Contact` numa base viva — a
 * tradução na borda custa uma consulta e não arrisca dado nenhum.
 *
 * A busca é pela **chave natural**, não pelo id: `inboxId` + `channelThreadId`
 * é o par que o schema já declara único, e é o único que identifica a conversa
 * sem depender de como o id foi formado. O id é apenas o desempate para linhas
 * antigas — e mesmo ele vai escopado por conta, porque um id de outra conta
 * precisa responder "não existe".
 *
 * Quando nada é encontrado, os ids sugeridos passam intactos: é chat novo, e
 * o formato escopado é o certo para criá-lo.
 */
export const resolveStoredIds = async (
  accountId: string,
  inboxId: string | undefined,
  chat: ChatIdentity,
): Promise<ChatIdentity> => {
  const phoneDigits = chat.phone.replace(/\D/g, '');
  const digitsWithout9 =
    phoneDigits.length === 13 && phoneDigits.startsWith('55') && phoneDigits[4] === '9'
      ? `${phoneDigits.slice(0, 4)}${phoneDigits.slice(5)}`
      : undefined;
  const digitsWith9 =
    phoneDigits.length === 12 && phoneDigits.startsWith('55')
      ? `${phoneDigits.slice(0, 4)}9${phoneDigits.slice(4)}`
      : undefined;

  const conversation = inboxId
    ? await prisma.conversation.findFirst({
        where: {
          accountId,
          inboxId,
          OR: [
            { channelThreadId: chat.jid },
            ...(phoneDigits ? [{ channelThreadId: `${phoneDigits}@s.whatsapp.net` }] : []),
            ...(digitsWithout9 ? [{ channelThreadId: `${digitsWithout9}@s.whatsapp.net` }] : []),
            ...(digitsWith9 ? [{ channelThreadId: `${digitsWith9}@s.whatsapp.net` }] : []),
            ...(chat.phone ? [{ contact: { phone: chat.phone } }] : []),
            ...(digitsWithout9 ? [{ contact: { phone: `+${digitsWithout9}` } }] : []),
            ...(digitsWith9 ? [{ contact: { phone: `+${digitsWith9}` } }] : []),
            { id: chat.conversationId },
            { id: `cv-wa-${accountId}-${chat.key}` },
            { id: `cv-wa-${chat.key}` },
          ],
        },
        orderBy: { lastActivityAt: 'desc' },
        select: { id: true, contactId: true },
      })
    : null;

  if (conversation) {
    return { ...chat, conversationId: conversation.id, contactId: conversation.contactId };
  }

  // Sem conversa, o contato ainda pode existir — cadastrado à mão no CRM, ou
  // trazido por outra caixa da mesma conta. Reaproveitá-lo evita um duplicado
  // com o mesmo telefone.
  const contact = await prisma.contact.findFirst({
    where: {
      accountId,
      OR: [
        { id: chat.contactId },
        { id: `ct-wa-${chat.key}` },
        ...(chat.phone ? [{ phone: chat.phone }] : []),
        ...(digitsWithout9 ? [{ phone: `+${digitsWithout9}` }] : []),
        ...(digitsWith9 ? [{ phone: `+${digitsWith9}` }] : []),
      ],
    },
    select: { id: true },
  });

  if (contact && inboxId) {
    // Se o contato já tem conversa nesta caixa, reutiliza a conversa dele
    const existingConv = await prisma.conversation.findFirst({
      where: { accountId, inboxId, contactId: contact.id },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    });
    if (existingConv) {
      return { ...chat, conversationId: existingConv.id, contactId: contact.id };
    }
  }

  return contact ? { ...chat, contactId: contact.id } : chat;
};

/** Contato já conhecido — da conversa, quando existe, ou da agenda. */
export const findStoredContact = async (
  accountId: string,
  chat: ChatIdentity,
): Promise<Contact | undefined> => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: chat.conversationId, accountId },
    include: { contact: { include: { labels: true } } },
  });
  if (conversation) return contactRow(conversation.contact);

  const contact = await prisma.contact.findFirst({
    where: {
      accountId,
      OR: [
        { id: chat.contactId },
        { id: `ct-wa-${accountId}-${chat.key}` },
        { id: `ct-wa-${chat.key}` },
        ...(chat.phone ? [{ phone: chat.phone }] : []),
      ],
    },
    include: { labels: true },
  });
  return contact ? contactRow(contact) : undefined;
};

export const ensureContact = async (
  accountId: string,
  contact: Contact,
  isGroup: boolean = contact.kind === 'grupo',
): Promise<void> => {
  const data = {
    name: contact.name,
    phone: contact.phone,
    channel: contact.channel,
    avatarTone: contact.avatarTone,
    customFields: asJson(contact.customFields ?? []),
    kind: isGroup ? 'grupo' : 'pessoa',
    avatarUrl: contact.avatarUrl ?? null,
    participantCount: contact.participantCount ?? null,
  };

  const update = {
    name: data.name,
    avatarUrl: data.avatarUrl,
    participantCount: data.participantCount,
    /**
     * Quem volta a escrever volta para a agenda.
     *
     * `deletedAt` tira o contato da lista sem apagar a conversa. Se ele mandar
     * mensagem depois disso, a conversa reaparece na caixa de entrada — e um
     * contato invisível ali seria alguém que ninguém consegue abrir nem
     * responder pelo cadastro. O arquivamento é sobre a agenda parada, não
     * sobre ignorar quem procurou a empresa.
     */
    deletedAt: null,
  };

  try {
    await prisma.contact.upsert({
      where: { id: contact.id },
      create: { ...data, id: contact.id, accountId },
      update,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // `upsert` não é atômico: ele lê, não acha, e insere. Duas mensagens do
    // mesmo contato chegando juntas — o caso normal de uma fila represada —
    // passam as duas pela leitura e as duas tentam inserir. A linha existe
    // agora, então só resta aplicar a atualização.
    await prisma.contact.update({ where: { id: contact.id, accountId }, data: update });
  }
};

export interface CommitInput {
  readonly accountId: string;
  readonly inboxId?: string;
  readonly chat: ChatIdentity;
  readonly contact: Contact;
  readonly message: Message;
  readonly preview: string;
  readonly at: Date;
  readonly fromMe: boolean;
  /**
   * Anuncio que originou a conversa, quando a mensagem veio de um clique.
   *
   * Nao e gravado na mensagem: e contexto de origem, e quem o consome e a
   * automacao do outro lado do webhook. Guardar no banco exigiria decidir onde,
   * e nenhuma tela pede por ele hoje.
   */
  readonly anuncio?: AdContext;
  /**
   * Grava sem anunciar.
   *
   * Usado enquanto a fila represada do WhatsApp é drenada. Anunciar mensagem
   * por mensagem ali faz a caixa de entrada se redesenhar centenas de vezes e
   * dá a impressão de que o painel está "carregando aos poucos" — quando, na
   * verdade, quem abrisse a tela depois veria tudo pronto de uma vez. Quem
   * silencia é responsável por anunciar o resultado ao final; ver o controle
   * de drenagem em `worker/session.ts`.
   */
  readonly silent?: boolean;
}

/** Estado da conversa que decide como a mensagem é anexada. */
interface ExistingConversation {
  readonly unreadCount: number;
  readonly status: string;
  readonly lastInboundAt: string | null;
  readonly inboxId: string;
  /** Nulo enquanto ninguém respondeu: decide qual dos dois prazos de SLA vale. */
  readonly firstResponseAt: Date | null;
  readonly inbox: { readonly businessHours: unknown } | null;
}

const CONVERSATION_STATE_SELECT = {
  unreadCount: true,
  status: true,
  lastInboundAt: true,
  inboxId: true,
  firstResponseAt: true,
  // O expediente da caixa é o relógio do prazo: fora dele o tempo não corre.
  inbox: { select: { businessHours: true } },
} as const;

const findConversationByThread = (
  accountId: string,
  inboxId: string,
  jid: string,
): Promise<ExistingConversation | null> =>
  prisma.conversation.findFirst({
    where: { accountId, inboxId, channelThreadId: jid },
    select: CONVERSATION_STATE_SELECT,
  });

const findConversationState = (
  accountId: string,
  conversationId: string,
): Promise<ExistingConversation | null> =>
  prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    select: CONVERSATION_STATE_SELECT,
  });

/**
 * Anexa a mensagem à conversa (criando-a se preciso) e publica o resultado.
 */
export const commitMessage = async (input: CommitInput): Promise<void> => {
  const { chat, contact } = input;

  await ensureContact(input.accountId, contact, chat.isGroup);

  const existing = await findConversationState(input.accountId, chat.conversationId);
  if (existing) {
    await attachToConversation(input, existing);
  } else {
    await createConversationWith(input);
  }

  // As automações rodam depois da gravação, nunca antes: uma regra que move o
  // card ou aplica etiqueta precisa encontrar a conversa já no estado novo.
  //
  // Só mensagem recebida dispara. O eco do que **nós** enviamos chega por aqui
  // igual, e disparar nele faria a resposta automática responder a si mesma.
  if (!input.fromMe) {
    // Respostas automáticas de caixa: saudação, ausência e leitura da nota da
    // pesquisa de satisfação. As regras (inclusive as travas de repetição)
    // moram em `inbox-auto-messages` — aqui só entra o que este ponto sabe: de
    // qual caixa é a mensagem, e se a conversa nasceu com ela.
    if (!chat.isGroup) {
      try {
        const inboxId = input.inboxId ?? existing?.inboxId;
        if (inboxId) {
          const { captureCsatAnswer, runInboundAutoReplies } =
            await import('./inbox-auto-messages');

          // Uma resposta de pesquisa não é o começo de conversa nenhum: se ela
          // for consumida como nota, nem saudação nem ausência têm o que dizer.
          const virouNota = await captureCsatAnswer(
            input.accountId,
            chat.conversationId,
            input.preview,
          );

          if (!virouNota) {
            await runInboundAutoReplies({
              accountId: input.accountId,
              inboxId,
              conversationId: chat.conversationId,
              channelThreadId: chat.jid,
              phone: contact.phone,
              isNewConversation: !existing,
            });
          }
        }
      } catch (err) {
        console.warn('[wa-store] Falha ao processar resposta automática:', err);
      }
    }

    await dispararAutomacoes({
      accountId: input.accountId,
      trigger: existing ? 'mensagem_recebida' : 'conversa_criada',
      conversationId: chat.conversationId,
      ...(input.preview ? { messageText: input.preview } : {}),
    });

    // Sistemas de fora recebem o mesmo gatilho das automações internas, e pela
    // mesma razão de ordem: quem for ler a conversa por API logo depois precisa
    // encontrá-la no estado que o evento descreve.
    await dispararWebhooks(existing ? 'mensagem.recebida' : 'conversa.criada', {
      contaId: input.accountId,
      ...(input.inboxId ? { caixaEntradaId: input.inboxId } : {}),
      conversa: { id: chat.conversationId, nova: !existing },
      contato: {
        id: contact.id,
        nome: contact.name,
        telefone: contact.phone,
        jid: chat.jid,
        ehGrupo: chat.isGroup,
        ...(contact.email ? { email: contact.email } : {}),
        ...(contact.company ? { empresa: contact.company } : {}),
        ...(contact.avatarUrl ? { avatarUrl: contact.avatarUrl } : {}),
        etiquetas: contact.labels.map((etiqueta) => etiqueta.name),
      },
      mensagem: mensagemDoPayload(input.message, input.preview, input.at, input.fromMe),
      ...(input.anuncio ? { anuncio: input.anuncio } : {}),
    });
  }
};

/**
 * Cria a conversa com a primeira mensagem dentro.
 *
 * O `P2002` aqui não é caso excepcional: entre o `findFirst` acima e este
 * `create` existe uma janela, e uma fila represada entrega várias mensagens do
 * mesmo contato ao mesmo tempo — todas veem "conversa não existe" e todas
 * tentam criá-la. Antes essa exceção subia sem tratamento, a promise do handler
 * rejeitava sem ninguém para ouvir (o emissor do Baileys não aguarda o
 * listener) e **a mensagem era perdida em silêncio**. Quem perdeu a corrida
 * agora simplesmente anexa à conversa que o vencedor acabou de criar.
 */
const createConversationWith = async (input: CommitInput): Promise<void> => {
  const { chat, contact, message, preview, at, fromMe } = input;
  const targetInboxId = input.inboxId ?? `ibx-${input.accountId}`;

  try {
    await prisma.conversation.create({
      data: {
        id: chat.conversationId,
        accountId: input.accountId,
        contactId: contact.id,
        channel: 'whatsapp',
        inboxId: targetInboxId,
        queue: chat.isGroup ? 'Grupos' : 'Geral',
        status: 'aberta',
        statusLabel: 'Em andamento',
        priority: 'baixa',
        unreadCount: fromMe ? 0 : 1,
        lastMessagePreview: preview,
        lastMessageAt: message.time,
        lastActivityAt: at,
        lastInboundAt: fromMe ? null : nowIso(at),
        channelThreadId: chat.jid,
        protocols: asJson([await novoProtocolo(input.accountId, at)]),
        messages: {
          create: {
            id: message.id,
            author: message.author,
            authorName: message.authorName ?? null,
            contentType: message.content.type,
            content: asJson(message.content),
            time: message.time,
            createdAt: at,
            deliveryStatus: message.deliveryStatus ?? null,
            isPrivate: message.isPrivate,
            externalId: message.externalId ?? null,
            origin: message.origin ?? null,
            senderJid: message.senderJid ?? null,
          },
        },
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // A releitura vai pelos dois caminhos porque a restrição violada pode ter
    // sido qualquer um dos dois: a chave primária (o vencedor da corrida usou o
    // mesmo id derivado) ou o índice único `inboxId + channelThreadId` (o
    // vencedor resolveu para um id antigo que este processo não tinha visto).
    const created =
      (await findConversationState(input.accountId, chat.conversationId)) ??
      (await findConversationByThread(input.accountId, targetInboxId, chat.jid));
    if (!created) {
      // A restrição violada não foi a da conversa. Sem estado para anexar, a
      // única saída honesta é deixar o erro subir.
      throw error;
    }
    await attachToConversation(input, created);
    return;
  }

  if (!input.silent) {
    await announce(
      input.accountId,
      'new_conversation',
      chat.conversationId,
      message,
      targetInboxId,
    );
  }
};

/**
 * Anuncia sem poder derrubar quem gravou.
 *
 * A gravação já aconteceu quando isto roda. Deixar uma falha de anúncio subir
 * trocava um problema pequeno — a tela demora a saber, e sabe no próximo
 * carregamento — por um grande: a exceção sobe até o listener do Baileys, e o
 * que vem depois no `commitMessage` (automações, webhooks) não roda.
 */
const announce = async (
  accountId: string,
  type: 'new_message' | 'new_conversation',
  conversationId: string,
  message: Message,
  inboxId?: string,
): Promise<void> => {
  try {
    await publish(accountId, type, conversationId, message, inboxId);
  } catch (error) {
    console.warn(
      `[wa-store] Mensagem ${message.id} gravada, mas o anúncio de ${type} falhou:`,
      error,
    );
  }
};

/** Anexa a mensagem a uma conversa que já existe. */
const attachToConversation = async (
  input: CommitInput,
  existing: ExistingConversation,
): Promise<void> => {
  const { chat, message, preview, at, fromMe } = input;

  /**
   * A caixa da conversa é a que ela já tem, não a da sessão que trouxe a
   * mensagem.
   *
   * Antes toda mensagem recebida regravava `inboxId` com a caixa do socket, e
   * isso desfazia em silêncio um "mover para outra caixa" assim que o contato
   * respondesse. Mover é uma decisão de atendimento e precisa durar; a sessão
   * que recebeu diz por qual número a mensagem entrou, não onde ela deve ficar.
   */
  const targetInboxId = existing.inboxId;

  try {
    await prisma.$transaction([
      prisma.message.upsert({
        where: { id: message.id },
        create: {
          id: message.id,
          conversationId: chat.conversationId,
          author: message.author,
          authorName: message.authorName ?? null,
          contentType: message.content.type,
          content: asJson(message.content),
          time: message.time,
          createdAt: at,
          deliveryStatus: message.deliveryStatus ?? null,
          isPrivate: message.isPrivate,
          externalId: message.externalId ?? null,
          origin: message.origin ?? null,
          senderJid: message.senderJid ?? null,
        },
        update: {
          deliveryStatus: message.deliveryStatus ?? undefined,
          authorName: message.authorName ?? undefined,
          senderJid: message.senderJid ?? undefined,
        },
      }),
      prisma.conversation.update({
        where: { id: chat.conversationId, accountId: input.accountId },
        data: {
          lastMessagePreview: preview,
          lastMessageAt: message.time,
          lastActivityAt: at,
          lastInboundAt: fromMe ? existing.lastInboundAt : nowIso(at),
          unreadCount: fromMe ? undefined : { increment: 1 },
          status: existing.status === 'resolvida' ? 'aberta' : existing.status,
          statusLabel: existing.status === 'resolvida' ? 'Em andamento' : undefined,
          channelThreadId: chat.jid,
          /**
           * Mensagem do contato arma o prazo de resposta.
           *
           * Este caminho não passa por `persistMessage` — a entrada do
           * WhatsApp escreve direto —, então o carimbo precisa acontecer aqui
           * também. Mensagem nossa (`fromMe`) não arma nada: quem está
           * esperando, do lado de cá, é o cliente.
           */
          ...(fromMe
            ? {}
            : calcularSla(
                at,
                !existing.firstResponseAt,
                normalizeBusinessHours(existing.inbox?.businessHours),
                at,
              )),
        },
      }),
    ]);
  } catch (error) {
    // A mensagem já estava gravada — reentrega do WhatsApp, ou duas cópias do
    // mesmo evento chegando juntas. Nada a fazer e nada a anunciar.
    if (isUniqueViolation(error)) return;
    throw error;
  }

  if (!input.silent) {
    await announce(input.accountId, 'new_message', chat.conversationId, message, targetInboxId);
  }
};

/**
 * A conversa de WhatsApp de um contato, se já existir alguma.
 *
 * Usada quando alguém pede "conversar" a partir do contato: quem já fala com a
 * gente tem um histórico, e abrir uma conversa nova ao lado dele partiria o
 * atendimento em dois lugares. A mais recente vence — é a que a pessoa espera
 * ver ao clicar.
 *
 * `inboxIds` recorta pelo que a sessão alcança: apontar para uma conversa de
 * uma caixa que a pessoa não pode abrir seria mandá-la para um 404.
 */
export const findContactConversation = async (
  accountId: string,
  contactId: string,
  inboxIds: readonly string[] | 'todas',
  recipientPhone?: string,
): Promise<{ readonly id: string; readonly inboxId: string } | null> =>
  prisma.conversation.findFirst({
    where: {
      accountId,
      contactId,
      channel: 'whatsapp',
      ...(recipientPhone
        ? { channelThreadId: `${recipientPhone.replace(/\D/g, '')}@s.whatsapp.net` }
        : {}),
      ...(inboxIds === 'todas' ? {} : { inboxId: { in: [...inboxIds] } }),
    },
    orderBy: { lastActivityAt: 'desc' },
    select: { id: true, inboxId: true },
  });

/**
 * Abre a conversa por onde uma mensagem nossa vai sair.
 *
 * O id e o `channelThreadId` seguem exatamente a forma que a entrada usa
 * (`resolveStoredIds`): é o que faz a resposta do contato cair **nesta**
 * conversa em vez de abrir outra ao lado. Errar aqui não daria erro nenhum —
 * daria duas conversas com a mesma pessoa, e ninguém entenderia por quê.
 *
 * Idempotente por construção: se a linha já existe, ela é devolvida. Duas
 * pessoas clicando em "conversar" ao mesmo tempo não criam duas conversas.
 */
export const openOutboundConversation = async (input: {
  readonly accountId: string;
  readonly inboxId: string;
  readonly contact: Contact;
  readonly recipientPhone?: string;
}): Promise<{ readonly id: string; readonly created: boolean }> => {
  const { accountId, inboxId, contact, recipientPhone } = input;

  let jid: string;
  let id: string;

  if (contact.kind === 'grupo') {
    const match = contact.id.match(/^ct-wa-[^-]+-g-(.+)$/);
    const matched = match?.[1];
    const groupId = matched ?? contact.id.replace(/^ct-wa-[^-]+-/, '');
    jid = groupId.endsWith('@g.us') ? groupId : `${groupId}@g.us`;
    const cleanId = groupId.replace('@g.us', '');
    id = `cv-wa-${inboxId}-g-${cleanId}`;
  } else {
    const digits = (recipientPhone ?? contact.phone).replace(/\D/g, '');
    if (!digits) throw new Error('O contato não tem telefone para receber uma mensagem.');
    jid = `${digits}@s.whatsapp.net`;
    id = `cv-wa-${inboxId}-${digits}`;
  }

  const existing = await prisma.conversation.findFirst({
    where: { accountId, inboxId, channelThreadId: jid },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const at = new Date();

  try {
    const created = await prisma.conversation.create({
      data: {
        id,
        accountId,
        contactId: contact.id,
        channel: 'whatsapp',
        inboxId,
        queue: 'Geral',
        status: 'aberta',
        statusLabel: 'Em andamento',
        priority: 'baixa',
        // Ninguém escreveu para nós: a conversa nasce lida.
        unreadCount: 0,
        lastMessagePreview: '',
        lastMessageAt: '',
        lastActivityAt: at,
        lastInboundAt: null,
        channelThreadId: jid,
        protocols: asJson([await novoProtocolo(accountId, at)]),
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Perdeu a corrida, ou o id derivado já pertence a uma conversa desta
    // conta noutra caixa. Nos dois casos a conversa existe e é dela que a
    // mensagem deve sair.
    const winner = await prisma.conversation.findFirst({
      where: { accountId, OR: [{ id }, { inboxId, channelThreadId: jid }] },
      select: { id: true },
    });
    if (!winner) throw error;
    return { id: winner.id, created: false };
  }
};

/**
 * A escada do status de entrega, do mais fraco ao mais forte.
 *
 * Um recibo nunca desfaz outro mais adiantado. O WhatsApp manda um recibo por
 * degrau (`SERVER_ACK`, depois `DELIVERY_ACK`, depois `READ`) e nada garante
 * que eles cheguem nessa ordem: cada um vira uma gravação assíncrona no
 * Postgres, e duas gravações em voo se ultrapassam.
 *
 * Era essa a origem dos tracinhos desiguais — duas mensagens seguidas, as duas
 * entregues, só uma com dois tracinhos. O `entregue` chegava, era gravado, e o
 * `enviado` da mesma mensagem chegava logo atrás e **rebaixava** a linha de
 * volta para um tracinho. Quem perdia a corrida decidia o que a tela mostrava.
 */
const DEGRAU: Record<NonNullable<Message['deliveryStatus']>, number> = {
  falha: 0,
  enviando: 1,
  enviado: 2,
  entregue: 3,
  lido: 4,
};

/** Os status que um novo status pode legitimamente substituir. */
const substituiveisPor = (novo: NonNullable<Message['deliveryStatus']>): string[] =>
  Object.keys(DEGRAU).filter((atual) => DEGRAU[atual as keyof typeof DEGRAU] < DEGRAU[novo]);

/** Recibo de entrega/leitura do canal. */
export const applyDeliveryUpdate = async (
  externalId: string,
  deliveryStatus: Message['deliveryStatus'],
  inboxId?: string,
): Promise<void> => {
  // O id pode chegar como `externalId` (mensagem que enviamos) ou como o id
  // próprio da mensagem (eco do celular pareado).
  // A conta sai da própria linha, e não de um parâmetro: um recibo chega com um
  // id só, e ir buscar a conta aqui é mais barato — e mais difícil de errar —
  // do que exigir que quem recebeu o recibo já soubesse de qual conta é.
  const row = await prisma.message.findFirst({
    where: {
      OR: [{ externalId }, { id: externalId }],
      ...(inboxId ? { conversation: { inboxId } } : {}),
    },
    select: { id: true, conversationId: true, conversation: { select: { accountId: true } } },
  });
  if (!row) return;

  /**
   * A guarda é a própria condição do `UPDATE`, não uma leitura seguida de
   * escrita: entre ler e gravar caberia exatamente a corrida que este trecho
   * existe para fechar. Uma linha sem status ainda é candidata — é o primeiro
   * recibo dela.
   */
  const { count } = deliveryStatus
    ? await prisma.message.updateMany({
        where: {
          id: row.id,
          OR: [
            { deliveryStatus: null },
            { deliveryStatus: { in: substituiveisPor(deliveryStatus) } },
          ],
        },
        data: { deliveryStatus },
      })
    : { count: 0 };

  // Recibo atrasado, que descrevia um degrau já superado. A linha continua
  // como está e não há mudança nenhuma para anunciar à tela.
  if (count === 0) return;

  // Um recibo por mensagem entregue e outro por mensagem lida — e cada um
  // carregava a conversa **inteira**, com timeline, contato e etiquetas. No
  // worker essa leitura não tinha destinatário nenhum (o evento sai por
  // `NOTIFY`, que leva só ids) e era a maior consumidora do pool na hora de
  // maior tráfego: era daqui que saía o `EMAXCONNSESSION` do log.
  const updated = waEventBus.hasConversationListeners
    ? await loadConversation(row.conversation.accountId, row.conversationId).catch(() => null)
    : null;

  const message = updated?.timeline.find(
    (item) => item.kind === 'message' && item.message.id === row.id,
  );

  waEventBus.emitConversation({
    type: 'message_updated',
    accountId: row.conversation.accountId,
    conversationId: row.conversationId,
    messageId: row.id,
    message: message?.kind === 'message' ? message.message : undefined,
    ...(updated ? { conversation: updated } : {}),
  });
};

/**
 * Uma reação chegou (ou foi retirada) sobre uma mensagem.
 *
 * O identificador que chega do canal é o da mensagem **no canal**, e a busca
 * aceita os dois (`externalId` ou `id`) porque o eco do aparelho pareado usa o
 * outro. A regra de substituição é a do próprio WhatsApp: uma reação por
 * pessoa. `emoji` vazio significa "retirei a minha" — é assim que o protocolo
 * representa a remoção, e é por isso que esta função faz as duas coisas.
 *
 * Idempotente de propósito: o WhatsApp reentrega eventos, e uma reação aplicada
 * duas vezes precisa dar no mesmo — sem isto, o mesmo 👍 apareceria duplicado
 * na bolha e a contagem passaria a medir reentregas.
 */
export const applyReaction = async (
  externalId: string,
  reaction: {
    readonly emoji: string;
    readonly actorId: string;
    readonly by: MessageReaction['by'];
    readonly authorName?: string;
  },
  inboxId?: string,
): Promise<void> => {
  const row = await prisma.message.findFirst({
    where: {
      OR: [{ externalId }, { id: externalId }],
      ...(inboxId ? { conversation: { inboxId } } : {}),
    },
    select: {
      id: true,
      conversationId: true,
      reactions: true,
      conversation: { select: { accountId: true, inboxId: true } },
    },
  });
  if (!row) return;

  const atuais = Array.isArray(row.reactions)
    ? (row.reactions as unknown as MessageReaction[])
    : [];
  const semAnterior = atuais.filter(
    (item) => item && typeof item === 'object' && item.actorId !== reaction.actorId,
  );

  const emoji = reaction.emoji.trim();
  const proximas: MessageReaction[] = emoji
    ? [
        ...semAnterior,
        {
          emoji,
          by: reaction.by,
          actorId: reaction.actorId,
          at: new Date().toISOString(),
          ...(reaction.authorName ? { authorName: reaction.authorName } : {}),
        },
      ]
    : semAnterior;

  // Nada mudou: reentrega do mesmo evento. Gravar e anunciar aqui faria a
  // timeline piscar sem motivo em toda reconexão.
  if (JSON.stringify(proximas) === JSON.stringify(atuais)) return;

  await prisma.message.update({
    where: { id: row.id },
    data: { reactions: asJson(proximas) },
  });

  const accountId = row.conversation.accountId;
  const updated = waEventBus.hasConversationListeners
    ? await loadConversation(accountId, row.conversationId).catch(() => null)
    : null;

  const message = updated?.timeline.find(
    (item) => item.kind === 'message' && item.message.id === row.id,
  );

  waEventBus.emitConversation({
    type: 'message_updated',
    accountId,
    conversationId: row.conversationId,
    inboxId: row.conversation.inboxId,
    messageId: row.id,
    message: message?.kind === 'message' ? message.message : undefined,
    ...(updated ? { conversation: updated } : {}),
  });
};

/**
 * O contato (ou o próprio aparelho pareado) apagou uma mensagem "para todos".
 *
 * O WhatsApp entrega isso como um `protocolMessage` do tipo `REVOKE`, com a
 * chave da mensagem original dentro — não como conteúdo de conversa, e é por
 * isso que `decodeWaMessage` o ignora. Aqui a linha original ganha `deletedAt`
 * e tem o conteúdo esvaziado: a bolha vira "Esta mensagem foi apagada", igual
 * ao que o próprio WhatsApp mostra, e a conversa não se recostura sem ela.
 *
 * Idempotente por construção: o `deletedAt: null` no filtro faz o eco do nosso
 * próprio "apagar" (que já marcou a linha antes de mandar o comando) não
 * disparar um segundo evento à toa.
 */
export const markMessageRevoked = async (
  externalId: string,
  inboxId?: string,
): Promise<void> => {
  const row = await prisma.message.findFirst({
    where: {
      OR: [{ externalId }, { id: externalId }],
      ...(inboxId ? { conversation: { inboxId } } : {}),
    },
    select: {
      id: true,
      conversationId: true,
      deletedAt: true,
      conversation: { select: { accountId: true } },
    },
  });
  if (!row || row.deletedAt) return;

  const accountId = row.conversation.accountId;

  await prisma.message.updateMany({
    where: { id: row.id, deletedAt: null },
    data: {
      deletedAt: new Date(),
      contentType: 'text',
      content: asJson({ type: 'text', text: '' }),
    },
  });

  // Se a apagada era a última, o resumo da conversa ainda mostra o texto dela
  // na lista — o conteúdo sobrevivendo no lugar mais visível do produto.
  const ultima = await prisma.message.findFirst({
    where: { conversationId: row.conversationId, isPrivate: false },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (ultima?.id === row.id) {
    await prisma.conversation.updateMany({
      where: { id: row.conversationId, accountId },
      data: { lastMessagePreview: '🚫 Mensagem apagada' },
    });
  }

  const updated = waEventBus.hasConversationListeners
    ? await loadConversation(accountId, row.conversationId).catch(() => null)
    : null;

  const message = updated?.timeline.find(
    (item) => item.kind === 'message' && item.message.id === row.id,
  );

  waEventBus.emitConversation({
    type: 'message_updated',
    accountId,
    conversationId: row.conversationId,
    messageId: row.id,
    message: message?.kind === 'message' ? message.message : undefined,
    ...(updated ? { conversation: updated } : {}),
  });
};

export interface ContactPatch {
  readonly name?: string;
  readonly avatarUrl?: string;
  readonly participantCount?: number;
}

/**
 * O mesmo remendo, endereçado pela chave natural do canal.
 *
 * Quem recebe um aviso de "contato mudou" do WhatsApp tem o JID, não o id da
 * conversa — e montar o id a partir do JID era exatamente o que atravessava
 * conta: `cv-wa-<numero>` acertava a conversa de quem tivesse chegado primeiro,
 * qualquer que fosse o workspace. A caixa é o que amarra o aviso à conta certa.
 */
export const patchContactByThread = async (
  accountId: string,
  inboxId: string,
  jid: string,
  patch: ContactPatch,
): Promise<void> => {
  const conversation = await prisma.conversation.findFirst({
    where: { accountId, inboxId, channelThreadId: jid },
    select: { id: true },
  });
  if (!conversation) return;
  await patchContact(conversation.id, patch);
};

/** Nome, foto ou número de participantes mudaram no canal. */
export const patchContact = async (
  conversationId: string,
  patch: {
    readonly name?: string;
    readonly avatarUrl?: string;
    readonly participantCount?: number;
  },
): Promise<void> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      accountId: true,
      contactId: true,
      contact: { select: { name: true, avatarUrl: true, participantCount: true } },
    },
  });
  if (!conversation) return;

  const current = conversation.contact;
  const unchanged =
    (patch.name === undefined || patch.name === current.name) &&
    (patch.avatarUrl === undefined || patch.avatarUrl === current.avatarUrl) &&
    (patch.participantCount === undefined || patch.participantCount === current.participantCount);
  // Publicar um evento sem mudança faria a caixa de entrada se redesenhar à toa.
  if (unchanged) return;

  await prisma.contact.update({
    where: { id: conversation.contactId, accountId: conversation.accountId },
    data: {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.avatarUrl === undefined ? {} : { avatarUrl: patch.avatarUrl }),
      ...(patch.participantCount === undefined ? {} : { participantCount: patch.participantCount }),
    },
  });

  const updated = await loadConversation(conversation.accountId, conversationId);
  if (updated) {
    waEventBus.emitConversation({
      type: 'conversation_updated',
      accountId: conversation.accountId,
      conversationId,
      conversation: updated,
    });
  }
};

/** Escopada por conta: um id de outra conta deve responder "não existe". */
export const conversationExists = async (
  accountId: string,
  conversationId: string,
): Promise<boolean> =>
  (await prisma.conversation.count({ where: { id: conversationId, accountId } })) > 0;

/**
 * Conversa pronta para viajar num evento de tempo real.
 *
 * Exposta porque o worker precisa da mesma leitura ao concluir um envio: e ele
 * quem carimba o id do canal na mensagem e anuncia a mudanca. Duplicar a
 * consulta la faria a forma do evento divergir entre os dois motores.
 */
export const loadConversationForEvent = (
  accountId: string,
  conversationId: string,
): Promise<Conversation | null> => loadConversation(accountId, conversationId);

const loadConversation = async (
  accountId: string,
  conversationId: string,
): Promise<Conversation | null> => {
  // `findFirst` e nao `findUnique`: o id sozinho e unico, mas a conta e que
  // decide se esta conversa pode ser vista daqui. Os ids novos do WhatsApp ja
  // carregam a caixa (`cv-wa-<caixa>-<numero>`, e a caixa e de uma conta so),
  // mas os antigos nao — e o escopo aqui e o que impede um id antigo de ser
  // lido de fora da conta dele.
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    include: CONVERSATION_INCLUDE,
  });
  return row ? conversationRow(row) : null;
};

const publish = async (
  accountId: string,
  type: 'new_message' | 'new_conversation',
  conversationId: string,
  message: Message,
  inboxId?: string,
): Promise<void> => {
  if (type === 'new_conversation') {
    /**
     * A conversa só é carregada quando há quem a receba **aqui dentro**.
     *
     * Era carregada sempre, e no worker isso era uma consulta pesada por
     * conversa nova entregue a ninguém: o evento sai deste processo pelo
     * `NOTIFY`, que leva só identificadores, e quem recarrega a conversa é o
     * processo do site — ver `hasConversationListeners`.
     *
     * O custo não era só desperdício. Esta era a **única** leitura de banco no
     * caminho do anúncio da primeira mensagem de uma conversa, e ela ficava
     * depois da gravação: com o pool esgotado (`EMAXCONNSESSION`, que é o que o
     * log de produção mostrava), a exceção subia daqui, a conversa ficava
     * gravada e o anúncio nunca saía. Na tela, a conversa nova simplesmente não
     * aparecia — até a segunda mensagem, que segue por `new_message` e não
     * passa por aqui.
     */
    const conversation = waEventBus.hasConversationListeners
      ? await loadConversation(accountId, conversationId).catch(() => null)
      : null;

    waEventBus.emitConversation({
      type,
      accountId,
      conversationId,
      inboxId: inboxId ?? conversation?.inboxId,
      messageId: message.id,
      message,
      ...(conversation ? { conversation } : {}),
    });
    return;
  }

  const conversation = waEventBus.hasConversationListeners
    ? await loadConversation(accountId, conversationId).catch(() => null)
    : null;

  // O `messageId` acompanha o evento porque é ele que sobrevive à travessia do
  // `NOTIFY`: o objeto da mensagem fica para trás, e é por este id que o outro
  // processo a encontra ao reidratar.
  waEventBus.emitConversation({
    type,
    accountId,
    conversationId,
    inboxId: inboxId ?? conversation?.inboxId,
    messageId: message.id,
    message,
    ...(conversation ? { conversation } : {}),
  });
};

/**
 * Recupera o conteúdo de uma mensagem enviada anteriormente para atender
 * pedidos de reenvio de decifragem do Baileys (getMessage).
 */
export const findSentMessage = async (
  inboxId: string,
  key: { id?: string | null },
): Promise<{ conversation: string } | undefined> => {
  if (!key.id) return undefined;
  const msg = await prisma.message.findFirst({
    where: {
      externalId: key.id,
      ...(inboxId ? { conversation: { inboxId } } : {}),
    },
    select: { content: true },
  });
  if (!msg?.content || typeof msg.content !== 'object') return undefined;
  const content = msg.content as Record<string, unknown>;
  if (content['type'] === 'text' && typeof content['text'] === 'string') {
    return { conversation: content['text'] };
  }
  return undefined;
};
