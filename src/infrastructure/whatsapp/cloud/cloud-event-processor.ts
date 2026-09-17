import type { Contact } from '@/core/domain/contact';
import type { Message, MessageContent } from '@/core/domain/message';
import { asJson, prisma } from '@/infrastructure/db/prisma';
import { createNotification } from '@/infrastructure/notifications/create-notification';
import { commitHistoryBatch, type HistoryCommitItem } from '../wa-history-store';
import { aplicarAgendaNosContatos, type EntradaDaAgenda } from '../wa-contact-sync';
import {
  fallbackPersonName,
  nomeDoContato,
  nomeUtilizavel,
  timeLabel,
  toneFor,
} from '../wa-format';
import { isSafeMediaId, mediaStore, mediaUrlFor } from '../wa-media-store';
import {
  applyDeliveryUpdate,
  applyReaction,
  commitMessage,
  findStoredContact,
  loadConversationForEvent,
  resolveStoredIds,
} from '../wa-store';
import { base64ParaWebhook, mediaUrlAbsoluta } from '../wa-webhook-payload';
import { waEventBus } from '../whatsapp-events';
import {
  loadCloudConnection,
  markCloudConnectionError,
  type CloudConnection,
} from './cloud-connection';
import { cloudChatIdentity, cloudMediaSourceId, cloudMessageRowId } from './cloud-identity';
import {
  deliveryStatusFromCloud,
  translateCloudMessage,
  type CloudInboundMedia,
  type CloudInboundMessage,
} from './cloud-inbound';
import { buildCloudUpsertPayload } from './cloud-webhook-payload';
import { CloudApiError, deliveryErrorMessage, graphDownload, graphRequest } from './graph-client';

type Obj = Record<string, unknown>;
const isObj = (valor: unknown): valor is Obj =>
  Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const str = (valor: unknown): string | undefined =>
  typeof valor === 'string' && valor ? valor : undefined;

/** Teto do download de mídia recebida. O maior tipo da Meta é documento, 100 MB. */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export interface CloudEventRow {
  readonly id: string;
  readonly accountId: string | null;
  readonly inboxId: string | null;
  readonly kind: string;
  readonly payload: unknown;
  readonly attempts: number;
}

/**
 * O evento não pôde ser processado agora, mas pode depois.
 *
 * Separado de uma falha comum porque a resposta é outra: este volta para a
 * fila com espera; o outro é registrado e desiste, para não segurar os eventos
 * seguintes do mesmo contato para sempre.
 */
export class CloudEventRetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudEventRetry';
  }
}

const tamanhoLegivel = (bytes: number): string => {
  if (bytes <= 0) return '—';
  const unidades = ['B', 'KB', 'MB', 'GB'];
  const expoente = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unidades.length - 1);
  const valor = bytes / 1024 ** expoente;
  return `${valor >= 10 || expoente === 0 ? Math.round(valor) : valor.toFixed(1)} ${unidades[expoente]}`;
};

const conteudoDaMidia = (
  media: CloudInboundMedia,
  url: string,
  size: number,
  fallback: MessageContent,
): MessageContent => {
  switch (media.kind) {
    case 'image':
      return { type: 'image', url, ...(media.caption ? { caption: media.caption } : {}) };
    case 'video':
      return {
        type: 'video',
        url,
        mimeType: media.mimeType,
        ...(media.caption ? { caption: media.caption } : {}),
      };
    case 'sticker':
      return { type: 'sticker', url, animated: Boolean(media.animated) };
    case 'audio':
      return {
        type: 'audio',
        duration: fallback.type === 'audio' ? fallback.duration : '0:00',
        url,
        mimeType: media.mimeType,
        voice: Boolean(media.voice),
      };
    case 'document':
      return {
        type: 'document',
        fileName: media.fileName ?? 'documento',
        size: tamanhoLegivel(size),
        url,
      };
  }
};

/**
 * Baixa a mídia da Meta e guarda no depósito do CRM.
 *
 * Agora, e não quando alguém abrir: o id da Meta morre em 7 dias. Falha
 * transitória devolve `retry` para o evento voltar à fila; recusa definitiva
 * deixa a mensagem com o texto de reserva, que é melhor do que não gravá-la.
 */
const materializarMidia = async (
  conn: CloudConnection,
  msg: CloudInboundMessage,
  attempts: number,
): Promise<{ content: MessageContent; bytes?: Buffer; url?: string }> => {
  const media = msg.media;
  if (!media?.metaMediaId) return { content: msg.content };

  const escopo = { accountId: conn.accountId, inboxId: conn.inboxId, kind: 'mensagem' as const };
  const sourceId = cloudMediaSourceId(msg.wamid);
  if (!isSafeMediaId(sourceId)) return { content: msg.content };

  const jaGuardada = await mediaStore.publicId(sourceId, escopo).catch(() => null);
  if (jaGuardada) {
    const guardada = await mediaStore.read(sourceId, escopo).catch(() => null);
    const bytes = guardada ? await guardada.bytes().catch(() => undefined) : undefined;
    const url = mediaUrlFor(jaGuardada);
    return {
      content: conteudoDaMidia(media, url, guardada?.size ?? 0, msg.content),
      url,
      ...(bytes ? { bytes } : {}),
    };
  }

  try {
    const info = await graphRequest<{ readonly url?: string; readonly mime_type?: string }>({
      path: media.metaMediaId,
      token: conn.token,
      query: { phone_number_id: conn.phoneNumberId },
    });
    if (!info.url) throw new CloudApiError({ message: 'A Meta não devolveu a URL da mídia.' });
    const baixado = await graphDownload(info.url, conn.token, MAX_DOWNLOAD_BYTES);
    const mimeType = info.mime_type ?? media.mimeType;
    const url = await mediaStore.save(
      sourceId,
      baixado.bytes,
      { mimeType, ...(media.fileName ? { fileName: media.fileName } : {}) },
      escopo,
    );
    return {
      content: url ? conteudoDaMidia(media, url, baixado.bytes.length, msg.content) : msg.content,
      bytes: baixado.bytes,
      ...(url ? { url } : {}),
    };
  } catch (error) {
    const retentavel = error instanceof CloudApiError ? error.retentavel : true;
    if (retentavel && attempts < 4) {
      throw new CloudEventRetry(
        `Mídia da mensagem ${msg.wamid} indisponível: ${error instanceof Error ? error.message : 'falha'}`,
      );
    }
    console.warn(
      `[cloud] Mídia de ${msg.wamid} não pôde ser baixada; fica o texto de reserva.`,
      error,
    );
    return { content: msg.content };
  }
};

const nomeDaCaixa = async (conn: CloudConnection): Promise<string> => {
  const caixa = await prisma.inbox
    .findFirst({ where: { id: conn.inboxId, accountId: conn.accountId }, select: { name: true } })
    .catch(() => null);
  return caixa?.name?.trim() || conn.inboxId;
};

/**
 * Mensagem do cliente (`messages`) ou da empresa pelo app (`smb_message_echoes`).
 *
 * Termina em `commitMessage`, o mesmo funil do QR Code: conversa, SLA,
 * protocolo, respostas automáticas, automações, pausa do agente e webhook para
 * o n8n saem de lá sem nenhuma regra repetida aqui.
 */
const processarMensagem = async (
  conn: CloudConnection,
  payload: Obj,
  fromMe: boolean,
  attempts: number,
): Promise<void> => {
  const raw = isObj(payload[fromMe ? 'echo' : 'message'])
    ? (payload[fromMe ? 'echo' : 'message'] as Obj)
    : null;
  if (!raw) return;
  const contactRaw = isObj(payload['contact']) ? payload['contact'] : undefined;
  const msg = translateCloudMessage(raw, {
    fromMe,
    ...(contactRaw ? { contact: contactRaw } : {}),
  });
  if (!msg) return;

  if (msg.reaction) {
    await applyReaction(
      msg.reaction.targetWamid,
      {
        emoji: msg.reaction.emoji,
        actorId: fromMe ? 'me' : msg.phone || msg.userId || 'contato',
        by: fromMe ? 'agent' : 'contact',
        ...(msg.profileName ? { authorName: msg.profileName } : {}),
      },
      conn.inboxId,
    );
    return;
  }

  // Cliente que chegou só com BSUID, mas que já tem telefone conhecido nesta
  // conta: a conversa é a mesma, e não uma nova ao lado.
  let phone = msg.phone;
  if (!phone && msg.userId) {
    const conhecido = await prisma.contact.findFirst({
      where: { accountId: conn.accountId, whatsappUserId: msg.userId, phone: { not: '' } },
      select: { phone: true },
    });
    if (conhecido?.phone) phone = conhecido.phone;
  }

  const identidade = cloudChatIdentity(
    { accountId: conn.accountId, inboxId: conn.inboxId },
    phone,
    msg.userId,
  );
  const chat = await resolveStoredIds(conn.accountId, conn.inboxId, identidade);
  const existente = await findStoredContact(conn.accountId, chat);

  const contact: Contact = {
    ...existente,
    id: existente?.id ?? chat.contactId,
    accountId: conn.accountId,
    channel: 'whatsapp',
    avatarTone: existente?.avatarTone ?? toneFor(chat.key),
    labels: existente?.labels ?? [],
    customFields: existente?.customFields ?? [],
    lastContactAt: new Date().toISOString(),
    lastContactLabel: 'Agora',
    name: nomeDoContato({
      cadastro: existente?.name,
      perfil: fromMe ? undefined : nomeUtilizavel(msg.profileName),
      reserva: phone
        ? fallbackPersonName(chat.phone, chat.jid)
        : (msg.profileName ?? 'Contato do WhatsApp'),
    }),
    phone: chat.phone,
    kind: 'pessoa',
    participantCount: undefined,
  } as Contact;

  const midia = await materializarMidia(conn, msg, attempts);

  const appMessage: Message = {
    id: cloudMessageRowId(chat.conversationId, msg.wamid),
    externalId: msg.wamid,
    conversationId: chat.conversationId,
    author: fromMe ? 'agent' : 'contact',
    authorName: fromMe ? (conn.verifiedName ?? 'WhatsApp Business') : contact.name,
    ...(fromMe ? { origin: 'canal' as const } : {}),
    content: midia.content,
    time: timeLabel(msg.at),
    ...(fromMe ? { deliveryStatus: 'enviado' as const } : {}),
    isPrivate: false,
  };

  const instance = await nomeDaCaixa(conn);

  await commitMessage({
    accountId: conn.accountId,
    inboxId: conn.inboxId,
    chat,
    contact,
    message: appMessage,
    preview: msg.preview,
    at: msg.at,
    fromMe,
    webhookPayload: (solint) => {
      const base64 = base64ParaWebhook(midia.bytes);
      const mediaUrl = base64 ? undefined : mediaUrlAbsoluta(midia.url);
      return buildCloudUpsertPayload({
        msg,
        raw,
        instance,
        instanceId: conn.inboxId,
        businessPhone: conn.displayPhoneNumber,
        solint,
        ...(base64 ? { base64 } : {}),
        ...(mediaUrl ? { mediaUrl } : {}),
      });
    },
  });

  if (msg.userId) {
    await prisma.contact
      .updateMany({
        where: { id: contact.id, accountId: conn.accountId, whatsappUserId: null },
        data: { whatsappUserId: msg.userId },
      })
      .catch(() => undefined);
  }
};

/** Recibo de envio, entrega, leitura ou falha de uma mensagem que o CRM mandou. */
const processarStatus = async (conn: CloudConnection, payload: Obj): Promise<void> => {
  const status = isObj(payload['status']) ? payload['status'] : null;
  const wamid = str(status?.['id']);
  if (!status || !wamid) return;
  const entrega = deliveryStatusFromCloud(str(status['status']));

  const pricing = isObj(status['pricing']) ? status['pricing'] : undefined;
  if (pricing) {
    await prisma.message
      .updateMany({
        where: {
          externalId: wamid,
          conversation: { inboxId: conn.inboxId, accountId: conn.accountId },
        },
        data: {
          channelMeta: asJson({
            pricing: {
              category: str(pricing['category']) ?? null,
              billable: pricing['billable'] === true,
              model: str(pricing['pricing_model']) ?? null,
            },
          }),
        },
      })
      .catch(() => undefined);
  }

  if (entrega !== 'falha') {
    if (entrega) await applyDeliveryUpdate(wamid, entrega, conn.inboxId);
    return;
  }

  const errors = Array.isArray(status['errors'])
    ? (status['errors'] as { code?: number; title?: string; message?: string }[])
    : undefined;
  const mensagem = deliveryErrorMessage(errors);

  const linha = await prisma.message.findFirst({
    where: {
      externalId: wamid,
      conversation: { inboxId: conn.inboxId, accountId: conn.accountId },
    },
    select: { id: true, conversationId: true },
  });
  if (!linha) return;
  await prisma.message.updateMany({
    where: { id: linha.id },
    data: { deliveryStatus: 'falha', dispatchError: mensagem },
  });

  const conversa = waEventBus.hasConversationListeners
    ? await loadConversationForEvent(conn.accountId, linha.conversationId).catch(() => null)
    : null;
  const item = conversa?.timeline.find(
    (entry) => entry.kind === 'message' && entry.message.id === linha.id,
  );
  waEventBus.emitConversation({
    type: 'message_updated',
    accountId: conn.accountId,
    conversationId: linha.conversationId,
    messageId: linha.id,
    ...(item?.kind === 'message' ? { message: item.message } : {}),
  });

  // Erro que é da conta, e não do contato, precisa de alguém olhando.
  const codigo = errors?.[0]?.code;
  if (codigo === 190 || codigo === 131031 || codigo === 131042 || codigo === 368) {
    await markCloudConnectionError(
      conn.inboxId,
      mensagem,
      codigo === 190 ? { status: 'erro' } : {},
    );
    await avisarAdministradores(conn, `API oficial (${conn.displayPhoneNumber}): ${mensagem}`);
  }
};

const avisarAdministradores = async (conn: CloudConnection, texto: string): Promise<void> => {
  await createNotification({
    accountId: conn.accountId,
    userId: null,
    kind: 'sistema',
    text: texto.slice(0, 280),
    href: '/configuracoes?secao=caixas',
    conversationId: '',
    inboxId: conn.inboxId,
    respeitarPreferencia: false,
  }).catch(() => undefined);
};

const STATUS_DE_TEMPLATE: Readonly<Record<string, string>> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PENDING: 'pending',
  PAUSED: 'paused',
  DISABLED: 'disabled',
  FLAGGED: 'approved',
  IN_APPEAL: 'pending',
  PENDING_DELETION: 'disabled',
  DELETED: 'disabled',
};

const processarStatusDeTemplate = async (conn: CloudConnection, payload: Obj): Promise<void> => {
  const value = isObj(payload['value']) ? payload['value'] : {};
  const evento = str(value['event'])?.toUpperCase();
  const status = evento ? STATUS_DE_TEMPLATE[evento] : undefined;
  if (!status) return;
  const id = value['message_template_id'];
  const nome = str(value['message_template_name']);
  const idioma = str(value['message_template_language']);

  await prisma.messageTemplate.updateMany({
    where: {
      accountId: conn.accountId,
      OR: [
        ...(id !== undefined ? [{ externalTemplateId: String(id) }] : []),
        ...(nome && idioma ? [{ name: nome, language: idioma, wabaId: conn.wabaId }] : []),
      ],
    },
    data: {
      status,
      rejectedReason: status === 'rejected' ? (str(value['reason']) ?? null) : null,
    },
  });

  if (status === 'rejected' || status === 'paused' || status === 'disabled') {
    await avisarAdministradores(
      conn,
      `Template "${nome ?? id}" ${status === 'rejected' ? 'recusado' : status === 'paused' ? 'pausado' : 'desativado'} pela Meta${
        str(value['reason']) ? `: ${str(value['reason'])}` : ''
      }.`,
    );
  }
};

/** Relê qualidade e limite na Meta: o webhook avisa que mudou, mas não diz tudo. */
const atualizarQualidade = async (conn: CloudConnection): Promise<void> => {
  try {
    const dados = await graphRequest<{
      readonly quality_rating?: string;
      readonly whatsapp_business_manager_messaging_limit?: string;
      readonly verified_name?: string;
    }>({
      path: conn.phoneNumberId,
      token: conn.token,
      query: { fields: 'quality_rating,whatsapp_business_manager_messaging_limit,verified_name' },
    });
    await prisma.whatsAppCloudConnection.updateMany({
      where: { inboxId: conn.inboxId },
      data: {
        ...(dados.quality_rating ? { qualityRating: dados.quality_rating } : {}),
        ...(dados.whatsapp_business_manager_messaging_limit
          ? { messagingLimit: dados.whatsapp_business_manager_messaging_limit }
          : {}),
        ...(dados.verified_name ? { verifiedName: dados.verified_name } : {}),
      },
    });
  } catch (error) {
    console.warn(`[cloud] Não foi possível reler a qualidade de ${conn.inboxId}:`, error);
  }
};

const processarConta = async (conn: CloudConnection, payload: Obj, kind: string): Promise<void> => {
  const value = isObj(payload['value']) ? payload['value'] : {};
  const evento = str(value['event']) ?? 'ATUALIZAÇÃO';

  if (kind === 'quality') {
    await atualizarQualidade(conn);
    if (evento === 'FLAGGED' || evento === 'DOWNGRADE') {
      await avisarAdministradores(
        conn,
        `A qualidade do número ${conn.displayPhoneNumber} caiu na Meta (${evento}). Revise os envios automáticos.`,
      );
    }
    return;
  }

  const ban = isObj(value['ban_info']) ? value['ban_info'] : undefined;
  const banido = str(ban?.['waba_ban_state']) === 'DISABLE';
  if (banido) {
    await markCloudConnectionError(
      conn.inboxId,
      'Conta do WhatsApp Business desativada pela Meta.',
      {
        status: 'erro',
      },
    );
  }
  const rotineiros = new Set(['VERIFIED_ACCOUNT', 'PARTNER_ADDED', 'PARTNER_APP_INSTALLED']);
  if (banido || !rotineiros.has(evento)) {
    await avisarAdministradores(conn, `Aviso da Meta sobre ${conn.displayPhoneNumber}: ${evento}.`);
  }
};

/**
 * Histórico da coexistência (até 180 dias), em lotes da Meta.
 *
 * Grava calado pelo mesmo importador do QR Code: sem automação, sem webhook e
 * sem resposta automática para mensagem de meses atrás.
 */
const processarHistorico = async (conn: CloudConnection, payload: Obj): Promise<void> => {
  const value = isObj(payload['value']) ? payload['value'] : {};
  const lotes = Array.isArray(value['history']) ? (value['history'] as unknown[]) : [];
  const numeroDaEmpresa = conn.displayPhoneNumber.replace(/\D/g, '');
  const itens: HistoryCommitItem[] = [];

  for (const lote of lotes) {
    if (!isObj(lote)) continue;
    const threads = Array.isArray(lote['threads']) ? (lote['threads'] as unknown[]) : [];
    for (const thread of threads) {
      if (!isObj(thread)) continue;
      const contatoWaId = str(thread['id']);
      const mensagens = Array.isArray(thread['messages']) ? (thread['messages'] as unknown[]) : [];
      for (const bruta of mensagens) {
        if (!isObj(bruta)) continue;
        const fromMe = str(bruta['from'])?.replace(/\D/g, '') === numeroDaEmpresa;
        const msg = translateCloudMessage(
          fromMe ? { ...bruta, to: str(bruta['to']) ?? contatoWaId } : bruta,
          { fromMe },
        );
        if (!msg || msg.reaction) continue;
        const phone = msg.phone || (contatoWaId ? `+${contatoWaId.replace(/\D/g, '')}` : '');
        const chat = cloudChatIdentity(
          { accountId: conn.accountId, inboxId: conn.inboxId },
          phone,
          msg.userId,
        );
        itens.push({
          chat,
          contactName: fallbackPersonName(chat.phone, chat.jid),
          message: {
            id: cloudMessageRowId(chat.conversationId, msg.wamid),
            externalId: msg.wamid,
            conversationId: chat.conversationId,
            author: fromMe ? 'agent' : 'contact',
            ...(fromMe ? { origin: 'canal' as const, deliveryStatus: 'enviado' as const } : {}),
            content: msg.content,
            time: timeLabel(msg.at),
            isPrivate: false,
          },
          preview: msg.preview,
          at: msg.at,
        });
      }
    }
  }

  if (itens.length > 0) await commitHistoryBatch(conn.accountId, conn.inboxId, itens);
};

/** Agenda do app WhatsApp Business (coexistência): nomes salvos viram nome do contato. */
const processarAgenda = async (conn: CloudConnection, payload: Obj): Promise<void> => {
  const value = isObj(payload['value']) ? payload['value'] : {};
  const itens = Array.isArray(value['state_sync']) ? (value['state_sync'] as unknown[]) : [];
  const entradas: EntradaDaAgenda[] = [];
  for (const item of itens) {
    if (!isObj(item) || item['type'] !== 'contact' || item['action'] === 'remove') continue;
    const contato = isObj(item['contact']) ? item['contact'] : {};
    const digitos = (str(contato['phone_number']) ?? '').replace(/\D/g, '');
    const nome = str(contato['full_name']) ?? str(contato['first_name']);
    if (digitos.length < 8 || !nome) continue;
    entradas.push({ phoneDigits: digitos, addressBookName: nome });
  }
  if (entradas.length > 0) await aplicarAgendaNosContatos(conn.accountId, entradas, new Set());
};

/** Processa um evento já reivindicado pelo runner. */
export const processCloudEvent = async (row: CloudEventRow): Promise<'done' | 'ignored'> => {
  if (!row.inboxId) return 'ignored';
  const conn = await loadCloudConnection(row.inboxId);
  if (!conn || (row.accountId && conn.accountId !== row.accountId)) return 'ignored';

  const payload = isObj(row.payload) ? row.payload : {};
  switch (row.kind) {
    case 'message':
      await processarMensagem(conn, payload, false, row.attempts);
      return 'done';
    case 'echo':
      await processarMensagem(conn, payload, true, row.attempts);
      return 'done';
    case 'status':
      await processarStatus(conn, payload);
      return 'done';
    case 'template_status':
      await processarStatusDeTemplate(conn, payload);
      return 'done';
    case 'account_update':
    case 'quality':
      await processarConta(conn, payload, row.kind);
      return 'done';
    case 'history':
      await processarHistorico(conn, payload);
      return 'done';
    case 'app_state_sync':
      await processarAgenda(conn, payload);
      return 'done';
    default:
      return 'ignored';
  }
};
