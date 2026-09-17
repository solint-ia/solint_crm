import { isApiTokenActor } from '@/core/domain/user';
import type { MessageContent } from '@/core/domain/message';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { dispararWebhooks } from '@/infrastructure/webhooks/webhook-dispatch';
import type {
  DispatchContext,
  DispatchMedia,
  DispatchQuote,
  DispatchResult,
  DispatchTarget,
  WhatsAppChannel,
  WhatsAppPairingOptions,
} from '../channel';
import { mediaStore } from '../wa-media-store';
import { mediaUrlAbsoluta } from '../wa-webhook-payload';
import type { WhatsAppOwner, WhatsAppStatusPayload } from '../whatsapp-events';
import {
  cloudStatusPayload,
  loadCloudConnection,
  markCloudConnectionError,
  type CloudConnection,
} from './cloud-connection';
import type { CloudInboundMessage } from './cloud-inbound';
import {
  markCloudRead,
  sendCloudMedia,
  sendCloudReaction,
  sendCloudText,
  sendCloudTyping,
} from './cloud-sender';
import { buildCloudUpsertPayload } from './cloud-webhook-payload';
import { CloudApiError } from './graph-client';

const NAO_CONECTADA = 'A API oficial desta caixa não está conectada.';

/** Conexão pronta para envio, ou a razão de não estar. */
export const requireCloudConnection = async (inboxId: string): Promise<CloudConnection> => {
  const conn = await loadCloudConnection(inboxId);
  if (!conn) throw new CloudApiError({ message: NAO_CONECTADA });
  if (conn.status === 'erro') {
    throw new CloudApiError({
      message: 'A API oficial desta caixa está com erro. Reconecte em Configurações › Caixas.',
    });
  }
  return conn;
};

/**
 * Registra o que uma recusa da Meta diz sobre a caixa, e não só sobre o envio.
 *
 * Token inválido derruba a caixa para todos: sem isso, cada atendente
 * descobriria o problema no próprio envio, um de cada vez.
 */
export const handleCloudSendError = async (inboxId: string, error: unknown): Promise<string> => {
  const message = error instanceof Error ? error.message : 'Falha ao enviar pela API oficial.';
  if (error instanceof CloudApiError && error.tokenInvalido) {
    await markCloudConnectionError(inboxId, message, { status: 'erro' });
  } else if (error instanceof CloudApiError && error.code === 133010) {
    await markCloudConnectionError(inboxId, message, { status: 'pendente_registro' });
  }
  return message;
};

const TIPO_DA_META: Readonly<Record<MessageContent['type'], string>> = {
  text: 'text',
  audio: 'audio',
  image: 'image',
  video: 'video',
  sticker: 'sticker',
  document: 'document',
  pending_media: 'document',
  template: 'text',
  system: 'text',
};

/**
 * Anuncia ao n8n (`mensagem.enviada`) o que o CRM acabou de mandar pela API oficial.
 *
 * No QR Code quem faz isso é o eco que o Baileys devolve. A Cloud API não ecoa
 * o que a própria API enviou — só manda os status —, então o anúncio sai aqui,
 * logo depois de a Meta aceitar. A regra de supressão é a mesma do QR: o que
 * entrou por token de API (a resposta do agente) não volta para o fluxo que a
 * escreveu.
 */
export const announceCloudSent = async (
  conn: CloudConnection,
  messageId: string,
  wamid: string,
): Promise<void> => {
  try {
    const linha = await prisma.message.findFirst({
      where: { id: messageId, conversation: { accountId: conn.accountId, inboxId: conn.inboxId } },
      select: {
        id: true,
        authorId: true,
        content: true,
        createdAt: true,
        conversationId: true,
        conversation: {
          select: { contactId: true, contact: { select: { phone: true, whatsappUserId: true } } },
        },
      },
    });
    if (!linha || isApiTokenActor(linha.authorId)) return;

    const content = readJson<MessageContent>(linha.content, { type: 'text', text: '' });
    const texto =
      content.type === 'text' || content.type === 'template' || content.type === 'system'
        ? content.text
        : '';
    const rawType = TIPO_DA_META[content.type] ?? 'text';
    const caption =
      content.type === 'image' || content.type === 'video' ? content.caption : undefined;
    const url = 'url' in content ? content.url : undefined;

    const msg: CloudInboundMessage = {
      wamid,
      at: linha.createdAt,
      fromMe: true,
      phone: linha.conversation.contact.phone,
      ...(linha.conversation.contact.whatsappUserId
        ? { userId: linha.conversation.contact.whatsappUserId }
        : {}),
      content,
      preview: texto,
      rawType,
      ...(rawType !== 'text'
        ? {
            media: {
              kind: rawType as 'image' | 'video' | 'audio' | 'document' | 'sticker',
              metaMediaId: '',
              mimeType: 'mimeType' in content && content.mimeType ? content.mimeType : '',
              ...(caption ? { caption } : {}),
              ...(content.type === 'document' ? { fileName: content.fileName } : {}),
              ...(content.type === 'audio' ? { voice: Boolean(content.voice) } : {}),
            },
          }
        : {}),
    };

    const caixa = await prisma.inbox.findFirst({
      where: { id: conn.inboxId, accountId: conn.accountId },
      select: { name: true },
    });
    const mediaUrl = mediaUrlAbsoluta(url);

    await dispararWebhooks(
      'mensagem.enviada',
      buildCloudUpsertPayload({
        msg,
        raw: { id: wamid, type: rawType, ...(texto ? { text: { body: texto } } : {}) },
        instance: caixa?.name?.trim() || conn.inboxId,
        instanceId: conn.inboxId,
        businessPhone: conn.displayPhoneNumber,
        solint: {
          contaId: conn.accountId,
          caixaEntradaId: conn.inboxId,
          conversaId: linha.conversationId,
          contatoId: linha.conversation.contactId,
          mensagemId: linha.id,
          conversaNova: false,
        },
        ...(mediaUrl ? { mediaUrl } : {}),
      }),
    );
  } catch (error) {
    console.warn('[cloud] Falha ao anunciar a mensagem enviada:', error);
  }
};

/** A última mensagem do cliente nesta conversa, como a Meta a identifica. */
export const lastInboundWamid = async (
  accountId: string,
  inboxId: string,
  conversationId: string,
): Promise<string | undefined> => {
  const linha = await prisma.message.findFirst({
    where: {
      conversationId,
      conversation: { accountId, inboxId },
      author: 'contact',
      externalId: { not: null },
      // A Meta só aceita leitura até 30 dias depois do recebimento.
      createdAt: { gt: new Date(Date.now() - 29 * 24 * 60 * 60_000) },
    },
    orderBy: { createdAt: 'desc' },
    select: { externalId: true },
  });
  return linha?.externalId ?? undefined;
};

/** Os bytes do anexo, lidos do depósito como no QR Code. */
export const readOutboundMedia = async (
  accountId: string,
  inboxId: string,
  media: DispatchMedia,
): Promise<Buffer> => {
  const stored = await mediaStore.read(media.mediaId, { accountId, inboxId, kind: 'mensagem' });
  if (!stored) throw new CloudApiError({ message: 'Anexo não encontrado no depósito.' });
  return stored.bytes();
};

/**
 * Motor da API oficial: HTTPS direto para a Meta, sem worker e sem fila.
 *
 * O envio é síncrono do ponto de vista de quem chama — a resposta já traz o id
 * da mensagem na Meta —, como no motor in-process.
 */
export class CloudApiWhatsAppChannel implements WhatsAppChannel {
  readonly engine = 'inprocess' as const;

  async getStatus(accountId: string, inboxId?: string): Promise<WhatsAppStatusPayload> {
    const status = inboxId ? await cloudStatusPayload(accountId, inboxId) : null;
    return (
      status ?? {
        ...(inboxId ? { inboxId } : {}),
        provider: 'cloud_api',
        status: 'desconectado',
        updatedAt: new Date().toISOString(),
      }
    );
  }

  async startSession(
    _owner: WhatsAppOwner,
    _options?: WhatsAppPairingOptions,
  ): Promise<WhatsAppStatusPayload> {
    throw new Error(
      'Esta caixa está conectada pela API oficial. Desconecte a API oficial antes de usar o QR Code.',
    );
  }

  async disconnect(accountId: string, inboxId?: string): Promise<void> {
    if (!inboxId) return;
    const { disconnectCloudInbox } = await import('./cloud-onboarding');
    await disconnectCloudInbox(accountId, inboxId);
  }

  private async enviar(
    context: DispatchContext,
    operacao: (conn: CloudConnection) => Promise<string>,
  ): Promise<DispatchResult> {
    try {
      const conn = await requireCloudConnection(context.inboxId);
      const wamid = await operacao(conn);
      await announceCloudSent(conn, context.messageId, wamid);
      return { ok: true, externalId: wamid };
    } catch (error) {
      return { ok: false, error: await handleCloudSendError(context.inboxId, error) };
    }
  }

  sendText(
    context: DispatchContext,
    target: DispatchTarget,
    text: string,
    quote?: DispatchQuote,
  ): Promise<DispatchResult> {
    return this.enviar(context, (conn) => sendCloudText(conn, target, text, quote));
  }

  sendMedia(
    context: DispatchContext,
    target: DispatchTarget,
    media: DispatchMedia,
    quote?: DispatchQuote,
  ): Promise<DispatchResult> {
    return this.enviar(context, async (conn) =>
      sendCloudMedia(
        conn,
        target,
        {
          kind: media.kind,
          data: await readOutboundMedia(context.accountId, context.inboxId, media),
          mimeType: media.mimeType,
          ...(media.fileName ? { fileName: media.fileName } : {}),
          ...(media.caption ? { caption: media.caption } : {}),
          ...(media.voice ? { voice: true } : {}),
        },
        quote,
      ),
    );
  }

  async deleteMessage(): Promise<DispatchResult> {
    return {
      ok: false,
      error: 'A API oficial do WhatsApp não permite apagar mensagens no aparelho do contato.',
    };
  }

  async sendReaction(
    context: DispatchContext,
    target: DispatchTarget,
    message: { readonly externalId: string },
    emoji: string,
  ): Promise<DispatchResult> {
    try {
      const conn = await requireCloudConnection(context.inboxId);
      return {
        ok: true,
        externalId: await sendCloudReaction(conn, target, message.externalId, emoji),
      };
    } catch (error) {
      return { ok: false, error: await handleCloudSendError(context.inboxId, error) };
    }
  }

  async markRead(accountId: string, conversationId: string, inboxId?: string): Promise<void> {
    if (!inboxId) return;
    try {
      const conn = await requireCloudConnection(inboxId);
      const wamid = await lastInboundWamid(accountId, inboxId, conversationId);
      if (wamid) await markCloudRead(conn, wamid);
    } catch (error) {
      // Confirmação de leitura é cortesia: não derruba a tela que a pediu.
      console.warn(
        '[cloud] Falha ao marcar como lida:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  async markReadMany(
    accountId: string,
    inboxId: string,
    conversationIds: readonly string[],
  ): Promise<void> {
    for (const conversationId of conversationIds) {
      await this.markRead(accountId, conversationId, inboxId);
    }
  }

  async sendPresence(
    context: { accountId: string; inboxId: string; conversationId: string },
    _target: DispatchTarget,
    status: 'composing' | 'paused' | 'recording',
  ): Promise<DispatchResult> {
    // "Gravando" e "parou" não existem na API oficial. Responder sucesso deixa
    // o fluxo do n8n igual para as duas caixas.
    if (status !== 'composing') return { ok: true };
    try {
      const conn = await requireCloudConnection(context.inboxId);
      const wamid = await lastInboundWamid(
        context.accountId,
        context.inboxId,
        context.conversationId,
      );
      if (!wamid) return { ok: true };
      await sendCloudTyping(conn, wamid);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: await handleCloudSendError(context.inboxId, error) };
    }
  }
}
