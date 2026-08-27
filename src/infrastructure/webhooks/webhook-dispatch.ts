import { createHmac } from 'node:crypto';

import type { Message, MessageContent } from '@/core/domain/message';
import { prisma, readJson } from '@/infrastructure/db/prisma';

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
 */

/** Teto por entrega. Destino lento não pode segurar a fila de mensagens. */
const TIMEOUT_MS = 5_000;

/** Eventos emitidos. Os nomes são os mesmos oferecidos na tela de integrações. */
export type WebhookEvent =
  'mensagem.recebida' | 'conversa.criada' | 'conversa.resolvida' | 'contato.criado';

interface LinhaWebhook {
  readonly id: string;
  readonly url: string;
  readonly secret: string | null;
}

/**
 * Corpo entregue ao destino.
 *
 * As chaves são em português pelo mesmo motivo que os nomes de evento são
 * (`mensagem.recebida`): quem cadastra o webhook lê os dois lado a lado na
 * mesma tela, e alternar idioma entre um e outro só criaria dúvida.
 *
 * Tudo que uma automação costuma precisar vem no primeiro nível de cada bloco,
 * sem obrigar quem monta o fluxo a cavar dentro de estruturas aninhadas.
 */
export interface WebhookPayload {
  readonly evento: WebhookEvent;
  readonly enviadoEm: string;
  readonly contaId: string;
  readonly caixaEntradaId?: string;
  readonly conversa: {
    readonly id: string;
    /** `true` quando foi esta mensagem que abriu a conversa. */
    readonly nova: boolean;
  };
  readonly contato: {
    readonly id: string;
    readonly nome: string;
    /** E.164 (`+5579998396408`). Vazio em grupo. */
    readonly telefone: string;
    /** JID do WhatsApp — é o que um fluxo usa para responder pelo canal. */
    readonly jid: string;
    readonly ehGrupo: boolean;
    readonly email?: string;
    readonly empresa?: string;
    readonly avatarUrl?: string;
    readonly etiquetas: readonly string[];
  };
  /**
   * Anuncio que originou a conversa (Click-to-WhatsApp).
   *
   * Presente so na mensagem que veio do clique — normalmente a primeira da
   * conversa. E o que permite a automacao responder ja sabendo o interesse, em
   * vez de abrir perguntando.
   */
  readonly anuncio?: {
    readonly titulo: string;
    readonly conteudo: string;
    readonly clickId?: string;
    readonly link?: string;
  };
  readonly mensagem: {
    readonly id: string;
    readonly externalId?: string;
    readonly tipo: MessageContent['type'];
    /**
     * Representação em texto puro, seja qual for o tipo.
     *
     * Numa foto com legenda vem a legenda; num áudio, o rótulo. É o campo que
     * permite escrever uma condição no fluxo sem ramificar por tipo de mídia.
     */
    readonly texto: string;
    readonly deMim: boolean;
    readonly autor: Message['author'];
    readonly autorNome?: string;
    readonly recebidaEm: string;
    readonly midia?: {
      /**
       * Caminho da mídia **dentro desta aplicação**, relativo.
       *
       * Não é um link aberto: a rota exige sessão, de propósito — é conteúdo de
       * conversa de cliente. Um fluxo que precise dos bytes tem de autenticar.
       */
      readonly caminho?: string;
      readonly mimeType?: string;
      readonly nomeArquivo?: string;
      readonly duracao?: string;
      readonly legenda?: string;
    };
  };
}

/** Extrai o bloco de mídia do conteúdo, quando houver. */
const midiaDe = (content: MessageContent): WebhookPayload['mensagem']['midia'] => {
  switch (content.type) {
    case 'image':
      return { caminho: content.url, ...(content.caption ? { legenda: content.caption } : {}) };
    case 'video':
      return {
        caminho: content.url,
        ...(content.mimeType ? { mimeType: content.mimeType } : {}),
        ...(content.caption ? { legenda: content.caption } : {}),
      };
    case 'sticker':
      return { caminho: content.url };
    case 'audio':
      return {
        ...(content.url ? { caminho: content.url } : {}),
        ...(content.mimeType ? { mimeType: content.mimeType } : {}),
        duracao: content.duration,
      };
    case 'document':
      return {
        ...(content.url ? { caminho: content.url } : {}),
        nomeArquivo: content.fileName,
      };
    default:
      return undefined;
  }
};

/** Texto puro do conteúdo, para o campo que dispensa ramificar por tipo. */
const textoDe = (content: MessageContent, resumo: string): string => {
  if (content.type === 'text' || content.type === 'system') return content.text;
  if (content.type === 'template') return content.text;
  if (content.type === 'image' || content.type === 'video') return content.caption ?? resumo;
  if (content.type === 'document') return content.fileName;
  return resumo;
};

/** Assinatura no formato que n8n, Make e Zapier já sabem conferir. */
const assinar = (corpo: string, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(corpo).digest('hex')}`;

const entregar = async (
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

/** Monta o bloco `mensagem` do payload a partir do que a gravação já tem em mãos. */
export const mensagemDoPayload = (
  message: Message,
  resumo: string,
  at: Date,
  fromMe: boolean,
): WebhookPayload['mensagem'] => {
  const midia = midiaDe(message.content);
  return {
    id: message.id,
    ...(message.externalId ? { externalId: message.externalId } : {}),
    tipo: message.content.type,
    texto: textoDe(message.content, resumo),
    deMim: fromMe,
    autor: message.author,
    ...(message.authorName ? { autorNome: message.authorName } : {}),
    recebidaEm: at.toISOString(),
    ...(midia ? { midia } : {}),
  };
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
  payload: Omit<WebhookPayload, 'evento' | 'enviadoEm'>,
): Promise<void> => {
  try {
    const inscritos = await prisma.webhook.findMany({
      where: { accountId: payload.contaId, isActive: true },
      select: { id: true, url: true, secret: true, events: true },
    });

    // O filtro por evento é feito aqui, e não no `where`: `events` é uma coluna
    // JSON de strings, e procurar dentro dela custaria SQL específico do
    // Postgres para uma lista que tem meia dúzia de itens por conta.
    const alvos = inscritos.filter((webhook) =>
      readJson<readonly string[]>(webhook.events, []).includes(evento),
    );
    if (alvos.length === 0) return;

    const corpo = JSON.stringify({
      evento,
      enviadoEm: new Date().toISOString(),
      ...payload,
    } satisfies WebhookPayload);

    await Promise.all(
      alvos.map(async (webhook) => {
        try {
          await entregar(webhook, corpo, evento);
          await prisma.webhook.update({
            where: { id: webhook.id },
            data: { lastTriggeredAt: new Date(), failureCount: 0 },
          });
        } catch (erro) {
          const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
          console.warn(`[webhooks] ${webhook.url} não recebeu ${evento}: ${motivo}`);
          await prisma.webhook
            .update({ where: { id: webhook.id }, data: { failureCount: { increment: 1 } } })
            .catch(() => undefined);
        }
      }),
    );
  } catch (erro) {
    console.warn('[webhooks] Falha ao consultar os webhooks da conta:', erro);
  }
};
