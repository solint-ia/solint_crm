import { asJson, prisma } from '@/infrastructure/db/prisma';
import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';
import { splitCloudWebhook, type SplitCloudEvent } from './cloud-webhook-parse';

/** Teto documentado pela Meta para o corpo do webhook. */
export const MAX_WEBHOOK_BYTES = 3 * 1024 * 1024;

export interface CloudDestino {
  readonly inboxId: string;
  readonly accountId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
}

/**
 * Grava os eventos do corpo e avisa o processador. Não processa nada.
 *
 * `destinos` é quem pode receber: no webhook por conexão, só a própria conexão
 * (um app de uma empresa não grava no número de outra); no global, todas as
 * conexões do app da Solint. Evento de número que não está entre os destinos é
 * gravado como `ignored`, para diagnóstico, e a Meta recebe 200 — responder erro
 * a faria reenviar por sete dias algo que nunca vai ter para onde ir.
 */
export const ingestCloudEvents = async (
  body: unknown,
  destinos: (evento: SplitCloudEvent) => Promise<readonly CloudDestino[]>,
): Promise<{ readonly accepted: number; readonly ignored: number }> => {
  const eventos = splitCloudWebhook(body);
  const linhas: {
    accountId: string | null;
    inboxId: string | null;
    phoneNumberId: string;
    kind: string;
    dedupeKey: string;
    orderKey: string | null;
    payload: ReturnType<typeof asJson>;
    status: string;
  }[] = [];
  const caixasComEvento = new Set<string>();

  for (const evento of eventos) {
    const alvos = await destinos(evento);
    if (alvos.length === 0) {
      linhas.push({
        accountId: null,
        inboxId: null,
        phoneNumberId: evento.phoneNumberId,
        kind: evento.kind,
        dedupeKey: `ignored:${evento.dedupeKey}`,
        orderKey: null,
        payload: asJson({ ...evento.payload, wabaId: evento.wabaId }),
        status: 'ignored',
      });
      continue;
    }
    for (const alvo of alvos) {
      caixasComEvento.add(alvo.inboxId);
      linhas.push({
        accountId: alvo.accountId,
        inboxId: alvo.inboxId,
        phoneNumberId: alvo.phoneNumberId,
        kind: evento.kind,
        // Evento da conta inteira (template) vira um por caixa daquela conta.
        dedupeKey: alvos.length > 1 ? `${evento.dedupeKey}:${alvo.inboxId}` : evento.dedupeKey,
        orderKey: evento.orderKey ? `${alvo.inboxId}:${evento.orderKey}` : null,
        payload: asJson({ ...evento.payload, wabaId: evento.wabaId }),
        status:
          evento.kind === 'desconhecido' || evento.kind === 'user_preferences'
            ? 'ignored'
            : 'pending',
      });
    }
  }

  if (linhas.length > 0) {
    await prisma.whatsAppCloudEvent.createMany({ data: linhas, skipDuplicates: true });
  }
  if (caixasComEvento.size > 0) {
    await prisma.whatsAppCloudConnection
      .updateMany({
        where: { inboxId: { in: [...caixasComEvento] } },
        data: { lastWebhookAt: new Date() },
      })
      .catch(() => undefined);
    await postgresPubSub
      .publish(CHANNELS.WHATSAPP_CLOUD, { at: Date.now() })
      .catch(() => undefined);
  }

  const aceitos = linhas.filter((linha) => linha.status === 'pending').length;
  return { accepted: aceitos, ignored: linhas.length - aceitos };
};
