import { currentProtocol, type Protocol } from '@/core/domain/conversation';
import { hasVariables, interpolate } from '@/core/domain/message-variables';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { horaLabel } from '@/lib/datetime';

/**
 * De onde a mensagem automática veio.
 *
 * Fica gravado na coluna `origin` da mensagem, e não é só rótulo: é por ele que
 * cada regra descobre que **já disparou** nesta conversa. Sem essa marca a
 * mensagem de ausência responderia a cada mensagem da madrugada, uma por uma.
 */
export type AutoMessageOrigin =
  'saudacao' | 'ausencia' | 'encerramento' | 'espera' | 'csat' | 'automacao';

export interface AutoMessageOptions {
  readonly accountId: string;
  readonly inboxId: string;
  readonly conversationId: string;
  readonly recipient: {
    readonly channelThreadId?: string | null;
    readonly phone: string;
  };
  readonly text: string;
  readonly origin?: AutoMessageOrigin;
  readonly authorName?: string;
}

/**
 * Preenche as variáveis com o que a conversa e a conta têm.
 *
 * `agente.nome` fica com o rótulo da própria automática ("Mensagem de
 * saudação"): não há atendente por trás de uma automática, e inventar um nome
 * de pessoa seria pior do que dizer o que de fato enviou.
 */
const interpolarParaConversa = async (
  accountId: string,
  conversationId: string,
  texto: string,
): Promise<string> => {
  if (!hasVariables(texto)) return texto;

  const conversa = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    select: {
      protocols: true,
      account: { select: { name: true } },
      contact: { select: { name: true } },
    },
  });

  return interpolate(texto, {
    clienteNome: conversa?.contact?.name ?? '',
    agenteNome: '',
    empresa: conversa?.account?.name ?? '',
    protocolo: currentProtocol(readJson<readonly Protocol[]>(conversa?.protocols, []))?.code ?? '',
  });
};

/**
 * Envia uma mensagem automática (saudação, ausência, encerramento ou automação de regra).
 *
 * A mensagem é registrada no banco como mensagem pública (visível na timeline do
 * CRM e enviada ao cliente), despachada para o canal de WhatsApp (via Queue ou InProcess)
 * e emitida no barramento em tempo real.
 */
export async function dispatchAutoMessage({
  accountId,
  inboxId,
  conversationId,
  recipient,
  text,
  origin = 'automacao',
  authorName = 'Atendimento Automático',
}: AutoMessageOptions) {
  if (!text || !text.trim()) return null;

  /**
   * As automáticas também aceitam variáveis.
   *
   * Uma saudação com `{{empresa}}` ou um encerramento com `{{protocolo}}` são
   * exatamente o uso que a tela de mensagens automáticas sugere, e sem isto o
   * cliente recebia a chave crua — pior que na resposta rápida, porque aqui
   * ninguém revisa o texto antes de sair.
   */
  const cleanText = await interpolarParaConversa(accountId, conversationId, text.trim());
  const messageId = `msg-auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const time = horaLabel(new Date());

  const workerMode = process.env.SOLINT_WORKER === '1';
  const persisted = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        id: messageId,
        conversationId,
        author: 'system',
        authorName,
        // `text`, e nao `texto`. O resto do produto grava `'text'` — e a uniao
        // `MessageContent` so conhece esse. Com `'texto'` a bolha caia no
        // `default` do renderizador e toda automatica (saudacao, ausencia,
        // encerramento, espera, CSAT) aparecia no chat como "Midia nao
        // suportada", mesmo tendo chegado como texto normal no aparelho do
        // cliente. A coluna `content` e JSON, entao o compilador nao pegava.
        contentType: 'text',
        content: { type: 'text', text: cleanText },
        time,
        deliveryStatus: 'enviando',
        isPrivate: false,
        origin,
      },
    });

    await tx.conversation.updateMany({
      where: { id: conversationId, accountId },
      data: {
        lastMessagePreview: cleanText,
        lastMessageAt: time,
        lastActivityAt: new Date(),
      },
    });

    const command = workerMode
      ? await tx.whatsAppCommand.create({
          data: {
            inboxId,
            kind: 'send',
            payload: {
              recipient: {
                channelThreadId: recipient.channelThreadId ?? undefined,
                phone: recipient.phone,
              },
              content: { text: cleanText },
              accountId,
              conversationId,
              messageId: created.id,
            },
            status: 'pending',
            idempotencyKey: `message:${created.id}`,
          },
          select: { id: true },
        })
      : null;

    return { created, commandId: command?.id };
  });
  const created = persisted.created;

  // Despacho no canal WhatsApp
  let falhaDeEntrega: string | undefined;
  try {
    if (workerMode) {
      // Mensagem e comando já foram gravados na mesma transação. O NOTIFY é só
      // aceleração; a varredura encontra a linha mesmo se o aviso se perder.
      const { CHANNELS, postgresPubSub } = await import('@/infrastructure/db/postgres-pubsub');
      await postgresPubSub.publish(CHANNELS.COMMANDS, {
        inboxId,
        kind: 'send',
        id: persisted.commandId,
      });
    } else {
      // Dentro do servidor Next.js
      const { getWhatsAppChannel } = await import('./channel-provider');
      const channel = await getWhatsAppChannel();
      const resultado = await channel.sendText(
        {
          accountId,
          conversationId,
          messageId: created.id,
          inboxId,
        },
        {
          channelThreadId: recipient.channelThreadId ?? undefined,
          phone: recipient.phone,
        },
        cleanText,
      );

      /**
       * A recusa do canal **não** é exceção, e era por isso que sumia.
       *
       * `sendText` devolve `{ ok: false, error }` — não lança. O `await` solto
       * aqui descartava esse retorno, o `catch` abaixo nunca via nada, e
       * `falhaDeEntrega` ficava indefinida: a mensagem entrava no CRM com
       * aparência de enviada e nunca era despachada. Era exatamente o sintoma
       * de "ativei a mensagem de encerramento, finalizei o atendimento e o
       * cliente não recebeu" — sem erro em lugar nenhum, porque o único que
       * existiu foi jogado fora nesta linha.
       */
      if (!resultado.ok) {
        throw new Error(resultado.error ?? 'O canal recusou o envio da mensagem automática.');
      }
    }
  } catch (error) {
    console.warn('[auto-reply] Falha ao despachar mensagem automática para o WhatsApp:', error);
    /**
     * A mensagem já está gravada, e a falha precisa aparecer na timeline.
     *
     * Antes este `catch` só escrevia no console: a mensagem entrava no CRM com
     * `deliveryStatus` nulo, indistinguível de uma que saiu, e o cliente nunca
     * a recebia. Era o que tornava "finalizei o atendimento e a pesquisa não
     * chegou" impossível de diagnosticar de dentro do produto.
     */
    falhaDeEntrega = error instanceof Error ? error.message : 'Falha ao despachar no canal.';
    await prisma.message
      .update({
        where: { id: created.id },
        data: { deliveryStatus: 'falha', dispatchError: falhaDeEntrega },
      })
      .catch(() => {
        // Marcar a falha não pode virar uma segunda falha.
      });
  }

  // Notificação para o barramento de eventos em tempo real
  try {
    const { waEventBus } = await import('./whatsapp-events');
    waEventBus.emitConversation({
      type: 'new_message',
      accountId,
      conversationId,
      inboxId,
      messageId: created.id,
      message: {
        id: created.id,
        conversationId,
        author: 'system',
        authorName,
        contentType: 'text',
        content: { type: 'text', text: cleanText },
        time,
        createdAt: created.createdAt,
        isPrivate: false,
        origin,
        ...(falhaDeEntrega ? { deliveryStatus: 'falha' as const } : {}),
      },
    });
  } catch (error) {
    console.warn('[auto-reply] Falha ao emitir evento em tempo real:', error);
  }

  return { ...created, ...(falhaDeEntrega ? { deliveryStatus: 'falha' } : {}), falhaDeEntrega };
}
