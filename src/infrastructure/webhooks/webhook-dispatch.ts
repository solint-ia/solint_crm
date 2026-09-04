import { createHash, createHmac } from 'node:crypto';

import { asJson, prisma, readJson } from '@/infrastructure/db/prisma';
import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';

/**
 * Entrega de eventos a sistemas de fora (n8n, Make, Zapier, um endpoint próprio).
 *
 * **Por que este arquivo existe.** A tabela `Webhook`, a tela que a alimenta e
 * as colunas `secret`, `failureCount` e `lastTriggeredAt` já existiam — mas
 * nenhuma linha de código chamava a URL cadastrada. Dava para criar o webhook,
 * ativá-lo e vê-lo listado na tela de integrações; ele nunca disparava. Este
 * módulo é a metade que faltava.
 *
 * **O disparo é aguardado, e não solto em segundo plano.** É a mesma razão
 * registrada em `automations/dispatch.ts`: numa função serverless o processo
 * congela ao responder e a promessa órfã morre com ele — foi exatamente esse o
 * defeito que segurava o `NOTIFY` da fila de comandos por até 15 segundos.
 * Como esperar por um sistema de terceiros não pode travar a entrada de
 * mensagens, o preço da espera é limitado por `TIMEOUT_MS`.
 *
 * **O corpo entregue é a mensagem crua do WhatsApp, não o modelo do domínio.**
 * Ele era montado em chaves de português (`conversa`, `contato`, `mensagem`) a
 * partir de `Message`, e por isso só sabia dizer o que as telas mostram: um
 * tipo, um texto, um caminho de mídia. Quem integra precisa do que o WhatsApp
 * manda junto — a citação respondida, o anúncio que originou a conversa, o
 * `ptt` do áudio — e nada disso sobrevivia à tradução. Quem monta o corpo agora
 * é `whatsapp/wa-webhook-payload.ts`; aqui só se sabe entregá-lo.
 */

/** Teto por entrega. Destino lento não pode segurar a fila de mensagens. */
const TIMEOUT_MS = 5_000;

/**
 * Eventos emitidos. Os nomes são os mesmos oferecidos na tela de integrações.
 *
 * São o **assunto** da inscrição, e não o que vai no corpo: `event`, dentro do
 * payload, é sempre `messages.upsert`. A distinção existe porque quem cadastra
 * o webhook quer escolher "só o que chega" ou "também o que sai", e o protocolo
 * do WhatsApp não tem esse conceito — as três coisas são o mesmo evento lá.
 */
export type WebhookEvent =
  | 'mensagem.recebida'
  | 'mensagem.enviada'
  | 'conversa.criada'
  | 'conversa.resolvida'
  | 'contato.criado';

export interface LinhaWebhook {
  readonly id: string;
  readonly url: string;
  readonly secret: string | null;
}

/**
 * Ponteiros para o que o CRM gravou desta mensagem.
 *
 * Único bloco que não vem do WhatsApp, e está aqui por uma necessidade
 * concreta: `POST /api/v1/mensagens` aceita `conversaId`, e não há como
 * derivá-lo do `remoteJid` do lado de fora. Sem estes ids, um fluxo recebe a
 * mensagem e não tem como responder.
 *
 * A rota também aceita `jid` + `instanceId` desde a mesma mudança, então quem
 * preferir trabalhar só com os campos do WhatsApp pode ignorar este bloco
 * inteiro.
 */
export interface SolintRefs {
  readonly contaId: string;
  readonly caixaEntradaId?: string;
  readonly conversaId: string;
  readonly contatoId: string;
  readonly mensagemId?: string;
  /** `true` quando foi esta mensagem que abriu a conversa. */
  readonly conversaNova: boolean;
}

/** O bloco `data`, na forma em que o Baileys entrega a mensagem. */
export interface WebhookMessageData {
  readonly key: Record<string, unknown>;
  readonly pushName?: string;
  /** Nome do status de entrega (`DELIVERY_ACK`, `READ`, ...). */
  readonly status?: string;
  /** Conteúdo cru: `conversation`, `audioMessage`, `imageMessage`, ... */
  readonly message: Record<string, unknown>;
  /** Citação, menções e anúncio de origem, elevados do conteúdo. */
  readonly contextInfo: Record<string, unknown> | null;
  readonly messageType: string;
  /** Segundos, como o WhatsApp envia. */
  readonly messageTimestamp: number;
  readonly instanceId: string;
  readonly source: string;
  /** Só quando a mídia passou do teto do base64. Exige token da conta. */
  readonly mediaUrl?: string;
}

export interface WebhookPayload {
  readonly event: 'messages.upsert';
  /** Nome da caixa de entrada. */
  readonly instance: string;
  readonly data: WebhookMessageData;
  /** A URL deste destino. Preenchida por entrega. */
  readonly destination: string;
  readonly date_time: string;
  /** JID do número conectado na caixa. */
  readonly sender: string;
  readonly solint: SolintRefs;
}

/** Assinatura no formato que n8n, Make e Zapier já sabem conferir. */
const assinar = (corpo: string, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(corpo).digest('hex')}`;

export const entregarWebhook = async (
  webhook: LinhaWebhook,
  corpo: string,
  evento: WebhookEvent,
): Promise<void> => {
  const resposta = await fetch(webhook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Solint-CRM-Webhook/1',
      'X-Solint-Event': evento,
      ...(webhook.secret ? { 'X-Solint-Signature': assinar(corpo, webhook.secret) } : {}),
    },
    body: corpo,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resposta.ok) throw new Error(`destino respondeu ${resposta.status}`);
};

/**
 * Dispara um evento para todos os webhooks ativos da conta inscritos nele.
 *
 * Nunca lança: o cadastro de um sistema de fora não pode derrubar a gravação de
 * uma mensagem que já aconteceu. Falha vira contador e aviso no log — e o
 * contador é o que a tela de integrações mostra.
 */
export const dispararWebhooks = async (
  evento: WebhookEvent,
  payload: Omit<WebhookPayload, 'destination'>,
): Promise<void> => {
  try {
    const inboxId = payload.solint.caixaEntradaId;
    const inscritos = await prisma.webhook.findMany({
      where: {
        accountId: payload.solint.contaId,
        isActive: true,
        ...(inboxId
          ? {
              OR: [
                { allInboxes: true },
                {
                  allInboxes: false,
                  inboxes: {
                    some: {
                      inboxId,
                      inbox: { accountId: payload.solint.contaId },
                    },
                  },
                },
              ],
            }
          : { allInboxes: true }),
      },
      select: { id: true, url: true, secret: true, events: true },
    });

    // O filtro por evento é feito aqui, e não no `where`: `events` é uma coluna
    // JSON de strings, e procurar dentro dela custaria SQL específico do
    // Postgres para uma lista que tem meia dúzia de itens por conta.
    const alvos = inscritos.filter((webhook) =>
      readJson<readonly string[]>(webhook.events, []).includes(evento),
    );
    if (alvos.length === 0) return;

    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const dedupeKey = `${evento}:${payload.solint.mensagemId ?? payloadHash}`;

    // Outbox durável: receber a mensagem não depende da velocidade do n8n e
    // uma queda entre tentativas não perde o evento. A chave composta evita a
    // mesma mensagem ser entregue duas vezes por reprocessamento do Baileys.
    await prisma.webhookDelivery.createMany({
      data: alvos.map((webhook) => ({
        webhookId: webhook.id,
        accountId: payload.solint.contaId,
        inboxId: inboxId ?? null,
        event: evento,
        payload: asJson({ ...payload, destination: webhook.url }),
        dedupeKey,
        status: 'pending',
      })),
      skipDuplicates: true,
    });

    await postgresPubSub.publish(CHANNELS.WEBHOOKS, {
      accountId: payload.solint.contaId,
      event: evento,
    });
  } catch (erro) {
    console.warn('[webhooks] Falha ao consultar os webhooks da conta:', erro);
  }
};
