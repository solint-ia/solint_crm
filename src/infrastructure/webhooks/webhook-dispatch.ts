import { createHash, createHmac } from 'node:crypto';

import { agentWorksAt, normalizeAgentSchedule } from '@/core/domain/agent-schedule';
import { normalizeBusinessHours } from '@/core/domain/business-hours';
import { hasAiAgentAccess } from '@/config/ai-agent-access';
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

/**
 * `SolintRefs` mais o que só o despachante sabe.
 *
 * A separação existe para que os três pontos que montam corpo — a mensagem que
 * chega, o eco do que o CRM manda e a gêmea no processo em memória — não
 * precisem conhecer nem consultar a pausa. Eles descrevem a mensagem; o estado
 * da conversa no instante do disparo é lido num lugar só, e assim dois webhooks
 * da mesma mensagem nunca discordam entre si.
 */
export interface SolintRefsEntregues extends SolintRefs {
  /** A plataforma liberou o produto de IA para esta conta. */
  readonly agenteHabilitado: boolean;
  /**
   * O agente de IA está fora desta conversa neste instante.
   *
   * Quem integra usa isto para decidir se **responde**. O evento continua
   * chegando de qualquer jeito: a memória do agente precisa do que foi dito
   * enquanto o humano atendia, senão ele volta sem saber o que aconteceu.
   */
  readonly agentePausado: boolean;
  /**
   * Quando o agente volta sozinho.
   *
   * Ausente em dois casos que não devem ser confundidos: o agente não está
   * pausado, ou a pausa **não vence** — alguém assumiu a conversa pela tela, e
   * ela dura até esse alguém devolver. `agentePausado` é o campo que decide.
   */
  readonly agentePausadoAte?: string;
  /**
   * Indica se a mensagem ocorreu dentro da grade de funcionamento do agente de IA.
   * `false` quando fora do horário de atendimento do agente.
   */
  readonly agenteNoHorario?: boolean;
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
  readonly solint: SolintRefsEntregues;
}

/** Assinatura no formato que n8n, Make e Zapier já sabem conferir. */
const assinar = (corpo: string, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(corpo).digest('hex')}`;

/** Respostas 4xx que ainda dizem "tente de novo mais tarde". */
const REPETIVEIS = new Set([408, 425, 429]);

/**
 * O destino respondeu, e não com sucesso.
 *
 * `permanente` separa as duas famílias de recusa, que pedem respostas opostas.
 * Um 5xx, um 429 ou um timeout dizem "agora não": repetir com recuo é o certo.
 * Um 404 (fluxo do n8n desativado), um 400 ou um 413 dizem "isto nunca vai
 * passar": repetir oito vezes só segurava, na ordem estrita do webhook, todas
 * as entregas que vinham atrás desta.
 */
export class EntregaWebhookError extends Error {
  readonly status: number;
  readonly permanente: boolean;

  constructor(status: number) {
    super(`destino respondeu ${status}`);
    this.name = 'EntregaWebhookError';
    this.status = status;
    this.permanente = status < 500 && !REPETIVEIS.has(status);
  }
}

export const entregarWebhook = async (
  webhook: LinhaWebhook,
  corpo: string,
  evento: WebhookEvent,
  deliveryId?: string,
): Promise<void> => {
  const resposta = await fetch(webhook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Solint-CRM-Webhook/1',
      'X-Solint-Event': evento,
      ...(deliveryId ? { 'X-Solint-Delivery-Id': deliveryId } : {}),
      ...(webhook.secret ? { 'X-Solint-Signature': assinar(corpo, webhook.secret) } : {}),
    },
    body: corpo,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resposta.ok) throw new EntregaWebhookError(resposta.status);
};

/**
 * Webhooks ativos da conta que alcançam esta caixa, com os eventos de cada um.
 *
 * O filtro por evento fica com quem chama: `events` é uma coluna JSON de
 * strings, e procurar dentro dela custaria SQL específico do Postgres para uma
 * lista que tem meia dúzia de itens por conta.
 */
const webhooksDaCaixa = (accountId: string, inboxId: string | undefined) =>
  prisma.webhook.findMany({
    where: {
      accountId,
      isActive: true,
      ...(inboxId
        ? {
            OR: [
              { allInboxes: true },
              {
                allInboxes: false,
                inboxes: { some: { inboxId, inbox: { accountId } } },
              },
            ],
          }
        : { allInboxes: true }),
    },
    select: { id: true, url: true, secret: true, events: true },
  });

const assina = (webhook: { readonly events: unknown }, eventos: readonly WebhookEvent[]) =>
  readJson<readonly string[]>(webhook.events as never, []).some((evento) =>
    (eventos as readonly string[]).includes(evento),
  );

/**
 * Algum webhook desta caixa assina algum destes eventos?
 *
 * Existe para quem grava o evento-fonte perguntar **antes**: sem assinante, não
 * há o que entregar, e gravar o corpo mesmo assim enchia a outbox com uma linha
 * por mensagem — com a mídia em base64 dentro — em contas que nunca cadastraram
 * webhook nenhum.
 */
export const algumWebhookInscrito = async (
  accountId: string,
  inboxId: string | undefined,
  eventos: readonly WebhookEvent[],
): Promise<boolean> =>
  (await webhooksDaCaixa(accountId, inboxId)).some((webhook) => assina(webhook, eventos));

/**
 * O agente de IA desta caixa atendia no instante `quando`?
 *
 * É a regra do horário do agente, configurado em Caixas de entrada: fora dele,
 * os webhooks continuam sendo entregues, porém marcados com `agentePausado: true`
 * e `agenteNoHorario: false`. Isso garante que o n8n/Redis receba o histórico e
 * guarde o contexto da conversa na memória durante o dia, para que quando o agente
 * assumir no seu turno (à noite ou fim de semana), ele já saiba tudo o que foi
 * conversado entre o cliente e a equipe humana.
 *
 * Sem caixa (evento que não nasceu de uma conversa) ou caixa sem horário
 * ligado, a resposta é sim: é o comportamento de antes da regra existir.
 */
export const agenteAtendeEm = async (
  accountId: string,
  inboxId: string | undefined,
  quando: Date,
): Promise<boolean> => {
  if (!inboxId) return true;
  const caixa = await prisma.inbox.findFirst({
    where: { id: inboxId, accountId },
    select: { aiAgentSchedule: true, businessHours: true },
  });
  if (!caixa) return true;
  const agenda = normalizeAgentSchedule(
    caixa.aiAgentSchedule,
    normalizeBusinessHours(caixa.businessHours),
  );
  return agentWorksAt(agenda, quando);
};

/**
 * O instante que o horário do agente julga: o da mensagem, não o do disparo.
 *
 * Os dois costumam coincidir, mas não quando o worker esteve fora: a fila
 * represada chega de uma vez na volta, e uma mensagem das 23h entregue às 8h
 * seria julgada pelo horário das 8h — acordando o agente para o que chegou
 * quando ele não atendia.
 */
const momentoDaMensagem = (payload: WebhookPayloadEmMontagem): Date => {
  const segundos = Number(payload.data?.messageTimestamp);
  return Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date();
};

/**
 * Dispara um evento para todos os webhooks ativos da conta inscritos nele.
 *
 * Nunca lança: o cadastro de um sistema de fora não pode derrubar a gravação de
 * uma mensagem que já aconteceu. Falha vira contador e aviso no log — e o
 * contador é o que a tela de integrações mostra.
 */
/** O corpo como quem dispara o monta: sem os campos que o despachante preenche. */
export type WebhookPayloadEmMontagem = Omit<WebhookPayload, 'destination' | 'solint'> & {
  readonly solint: SolintRefs;
};

export const dispararWebhooks = async (
  evento: WebhookEvent,
  payload: WebhookPayloadEmMontagem,
  options: { readonly throwOnError?: boolean } = {},
): Promise<void> => {
  try {
    const inboxId = payload.solint.caixaEntradaId;

    const [noHorario, conta] = await Promise.all([
      agenteAtendeEm(payload.solint.contaId, inboxId, momentoDaMensagem(payload)),
      prisma.account.findUnique({
        where: { id: payload.solint.contaId },
        select: { aiAgentAccessEnabled: true },
      }),
    ]);
    const agenteHabilitado = Boolean(conta && hasAiAgentAccess(conta));

    // A pausa é lida aqui, e não em cada um dos três pontos que montam corpo:
    // é a mesma pergunta em todos, e a resposta muda entre um disparo e o
    // seguinte. Ler no despachante garante que os dois webhooks de uma mesma
    // mensagem enxerguem o mesmo estado.
    const conversa = await prisma.conversation.findFirst({
      where: { id: payload.solint.conversaId, accountId: payload.solint.contaId },
      select: { aiPausedUntil: true, aiPausedReason: true },
    });
    // A pausa do botão não tem prazo, então `agentePausadoAte` só aparece na que
    // vence sozinha. Quem integra decide por `agentePausado`, e não pela data:
    // ler "sem prazo" como "sem pausa" faria o agente responder por cima de
    // quem acabou de assumir a conversa.
    //
    // Fora do horário do agente de IA, `agentePausado` também é `true`: o webhook
    // é entregue para alimentar a memória/Redis do n8n, mas o bot não responde.
    const pausadoPorConversa = Boolean(
      conversa?.aiPausedReason &&
      (!conversa.aiPausedUntil || conversa.aiPausedUntil.getTime() > Date.now()),
    );
    const pausado = !agenteHabilitado || !noHorario || pausadoPorConversa;

    const corpo: Omit<WebhookPayload, 'destination'> = {
      ...payload,
      solint: {
        ...payload.solint,
        agenteHabilitado,
        agentePausado: pausado,
        agenteNoHorario: noHorario,
        ...(pausadoPorConversa && conversa?.aiPausedUntil
          ? { agentePausadoAte: conversa.aiPausedUntil.toISOString() }
          : {}),
      },
    };

    const inscritos = await webhooksDaCaixa(payload.solint.contaId, inboxId);
    const alvos = inscritos.filter((webhook) => assina(webhook, [evento]));
    if (alvos.length === 0) return;

    const payloadHash = createHash('sha256').update(JSON.stringify(corpo)).digest('hex');
    const dedupeKey = `${evento}:${corpo.solint.mensagemId ?? payloadHash}`;

    // Outbox durável: receber a mensagem não depende da velocidade do n8n e
    // uma queda entre tentativas não perde o evento. A chave composta evita a
    // mesma mensagem ser entregue duas vezes por reprocessamento do Baileys.
    await prisma.webhookDelivery.createMany({
      data: alvos.map((webhook) => ({
        webhookId: webhook.id,
        accountId: payload.solint.contaId,
        inboxId: inboxId ?? null,
        event: evento,
        payload: asJson({ ...corpo, destination: webhook.url }),
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
    if (options.throwOnError) throw erro;
    console.warn('[webhooks] Falha ao consultar os webhooks da conta:', erro);
  }
};
