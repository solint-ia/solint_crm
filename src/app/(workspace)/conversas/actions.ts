'use server';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CONVERSATION_STATUSES, PRIORITIES } from '@/core/domain/conversation';
import type { Message, MessageContent } from '@/core/domain/message';
import { can } from '@/core/domain/user';
import { canSendFreeText, MAX_MESSAGE_LENGTH } from '@/core/use-cases/send-message';
import { container } from '@/infrastructure/container';
import { dispararAutomacoes } from '@/infrastructure/automations/dispatch';
import type { DispatchResult } from '@/infrastructure/whatsapp/channel';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import { mediaStore } from '@/infrastructure/whatsapp/wa-media-store';
import { waEventBus } from '@/infrastructure/whatsapp/whatsapp-events';

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface SendMessageResult extends ActionResult {
  /** Mensagem persistida — o cliente troca a bolha otimista por esta. */
  readonly message?: Message;
}

/**
 * Traduz a resposta do canal para o estado da bolha na tela.
 *
 * Os tres caminhos de envio (texto, template, anexo) faziam esta mesma traducao
 * copiada. Agora ela mora num lugar so — inclusive o caso novo, `queued`.
 *
 * `queued` e o motor worker dizendo "aceitei, ainda nao enviei". A bolha fica em
 * "enviando" e quem a promove a "enviado" e o proprio worker, por um evento
 * `message_updated`, quando o WhatsApp confirmar. Tratar isso como sucesso
 * imediato exibiria um "enviado" que ninguem verificou.
 */
async function applyDispatch(
  accountId: string,
  conversationId: string,
  message: Message,
  sent: DispatchResult,
): Promise<{ message: Message; error?: string }> {
  if (sent.ok && sent.externalId) {
    await container.conversations.attachExternalId(
      accountId,
      conversationId,
      message.id,
      sent.externalId,
    );
    return { message: { ...message, externalId: sent.externalId, deliveryStatus: 'enviado' } };
  }

  if (sent.ok && sent.queued) {
    return { message: { ...message, deliveryStatus: 'enviando' } };
  }

  return {
    message: { ...message, deliveryStatus: 'falha' },
    ...(sent.error ? { error: sent.error } : {}),
  };
}

/**
 * Toda Server Action valida a entrada antes de tocar no dominio:
 * o cliente e sempre considerado não confiavel (REGRAS-GLOBAIS.md secao 6.1).
 */
const sendMessageSchema = z.object({
  conversationId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  isPrivate: z.boolean(),
});

export async function sendMessageAction(input: unknown): Promise<SendMessageResult> {
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Não foi possível enviar: dados inválidos.' };
  }

  const session = await container.session.getCurrentSession();
  const result = await container.useCases.sendMessage({ session, ...parsed.data });

  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }

  // A conversa vem do proprio caso de uso, que ja a carregou para checar a
  // janela HSM. Buscar de novo aqui era repetir a consulta mais cara do caminho
  // — ela traz a timeline junto.
  const { conversation } = result.value;
  let message = result.value.message;
  let dispatchError: string | undefined;

  // Nota interna nunca sai para o canal externo (REGRAS-GLOBAIS.md secao 4.1).
  if (!parsed.data.isPrivate) {
    if (conversation.channel === 'whatsapp') {
      const channel = await getWhatsAppChannel();
      const channelStatus = await channel.getStatus(session.account.id, conversation.inboxId);

      if (channelStatus.status === 'conectado') {
        const sent = await channel.sendText(
          {
            accountId: session.account.id,
            conversationId: conversation.id,
            messageId: message.id,
            inboxId: conversation.inboxId,
          },
          { channelThreadId: conversation.channelThreadId, phone: conversation.contact.phone },
          parsed.data.text,
        );
        const applied = await applyDispatch(session.account.id, conversation.id, message, sent);
        message = applied.message;
        dispatchError = applied.error;
      } else {
        dispatchError =
          channelStatus.error ?? 'WhatsApp desconectado: a mensagem não foi entregue.';
        message = { ...message, deliveryStatus: 'falha' };
      }
    }

    // Só a mensagem — deliberadamente sem `conversation`.
    //
    // Quem escuta substitui a conversa inteira quando ela vem no payload
    // (ver `use-inbox`), e a que temos aqui é o retrato de antes do envio: a
    // mensagem nova não está na timeline dela. Publicá-la faria a bolha recém
    // enviada desaparecer da tela de quem enviou. Sem ela, o cliente anexa a
    // mensagem à conversa que já tem — que é o comportamento correto para um
    // envio, e ainda poupa uma releitura do banco.
    waEventBus.emitConversation({
      type: 'new_message',
      accountId: session.account.id,
      conversationId: parsed.data.conversationId,
      messageId: message.id,
      message,
    });
  }

  return dispatchError ? { ok: false, error: dispatchError, message } : { ok: true, message };
}

const changeStatusSchema = z.object({
  conversationId: z.string().min(1).max(64),
  status: z.enum(CONVERSATION_STATUSES),
});

export async function changeConversationStatusAction(input: unknown): Promise<ActionResult> {
  const parsed = changeStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Status inválido.' };
  }

  const session = await container.session.getCurrentSession();
  const result = await container.useCases.changeConversationStatus({ session, ...parsed.data });
  if (!result.ok) return { ok: false, error: result.error.message };

  // Só dois dos status têm gatilho; os demais não disparam nada.
  const gatilho =
    parsed.data.status === 'pendente'
      ? ('conversa_pendente' as const)
      : parsed.data.status === 'resolvida'
        ? ('conversa_resolvida' as const)
        : undefined;

  if (gatilho) {
    await dispararAutomacoes({
      accountId: session.account.id,
      trigger: gatilho,
      conversationId: parsed.data.conversationId,
    });
  }

  waEventBus.emitConversation({
    type: 'conversation_updated',
    accountId: session.account.id,
    conversationId: parsed.data.conversationId,
    conversation: result.value,
  });

  return { ok: true };
}

const conversationIdSchema = z.object({ conversationId: z.string().min(1).max(64) });

/** Abrir a conversa no CRM zera o não-lido e confirma a leitura no celular. */
export async function markConversationReadAction(input: unknown): Promise<ActionResult> {
  const parsed = conversationIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Conversa inválida.' };

  const session = await container.session.getCurrentSession();
  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  if (!conversation) return { ok: false, error: 'Conversa não encontrada.' };

  await container.conversations.markAsRead(session.account.id, conversation.id);
  if (conversation.channel === 'whatsapp') {
    const channel = await getWhatsAppChannel();
    await channel.markRead(session.account.id, conversation.id, conversation.inboxId);
  }

  // Os demais atendentes precisam ver que a conversa deixou de estar não lida.
  const updated = await container.conversations.findById(
    session.account.id,
    conversation.id,
    session.inboxAccess,
  );
  if (updated) {
    waEventBus.emitConversation({
      type: 'conversation_updated',
      accountId: session.account.id,
      conversationId: updated.id,
      conversation: updated,
    });
  }

  return { ok: true };
}

/* ==========================================================================
   Triagem: responsável, prioridade e etiquetas.
   ========================================================================== */

/** Depois de escrever, todo mundo precisa ver — inclusive quem não agiu. */
const broadcast = async (conversationId: string) => {
  const session = await container.session.getCurrentSession();
  const updated = await container.conversations.findById(
    session.account.id,
    conversationId,
    session.inboxAccess,
  );
  if (updated) {
    waEventBus.emitConversation({
      type: 'conversation_updated',
      accountId: session.account.id,
      conversationId: updated.id,
      conversation: updated,
    });
  }
  return updated;
};

const assignSchema = z.object({
  conversationId: z.string().min(1).max(64),
  /** `null` devolve a conversa para a fila geral. */
  assigneeId: z.string().min(1).max(64).nullable(),
});

export async function assignConversationAction(input: unknown): Promise<ActionResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos para transferência.' };

  const session = await container.session.getCurrentSession();

  // O nome vem do servidor, nunca do payload: o cliente poderia mandar
  // "Camila Reis" apontando para o id de outra pessoa.
  let assignee: { id: string; name: string } | null = null;
  if (parsed.data.assigneeId) {
    const settings = await container.settings.get(session.account.id);
    const member = settings.members.find((user) => user.id === parsed.data.assigneeId);
    if (!member) return { ok: false, error: 'Agente não encontrado nesta conta.' };
    assignee = { id: member.id, name: member.name };
  }

  const result = await container.useCases.assignConversation({
    session,
    conversationId: parsed.data.conversationId,
    assignee,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  await broadcast(parsed.data.conversationId);
  return { ok: true };
}

const prioritySchema = z.object({
  conversationId: z.string().min(1).max(64),
  priority: z.enum(PRIORITIES),
});

export async function changeConversationPriorityAction(input: unknown): Promise<ActionResult> {
  const parsed = prioritySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Prioridade inválida.' };

  const session = await container.session.getCurrentSession();
  const result = await container.useCases.changeConversationPriority({ session, ...parsed.data });
  if (!result.ok) return { ok: false, error: result.error.message };

  await broadcast(parsed.data.conversationId);
  return { ok: true };
}

const labelsSchema = z.object({
  conversationId: z.string().min(1).max(64),
  labelIds: z.array(z.string().min(1).max(64)).max(20),
});

export async function setConversationLabelsAction(input: unknown): Promise<ActionResult> {
  const parsed = labelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Etiquetas inválidas.' };

  const session = await container.session.getCurrentSession();
  const settings = await container.settings.get(session.account.id);

  // Só etiquetas que existem nesta conta: o id chega do cliente.
  const labels = settings.labels.filter((label) => parsed.data.labelIds.includes(label.id));

  const result = await container.useCases.setConversationLabels({
    session,
    conversationId: parsed.data.conversationId,
    labels,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  // A etiqueta já está gravada; agora as regras que reagem a ela.
  await dispararAutomacoes({
    accountId: session.account.id,
    trigger: 'etiqueta_aplicada',
    conversationId: parsed.data.conversationId,
  });

  await broadcast(parsed.data.conversationId);
  return { ok: true };
}

const contactLabelsSchema = z.object({
  conversationId: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
  labelIds: z.array(z.string().min(1).max(64)).max(20),
});

/**
 * Etiquetas do contato — diferentes das da conversa.
 *
 * A da conversa descreve o atendimento ("Cobrança", "Urgente"); a do contato
 * descreve a pessoa ("VIP", "Revendedor") e vale para todos os atendimentos
 * dela. Por isso são dois controles, e não um.
 */
export async function setContactLabelsAction(input: unknown): Promise<ActionResult> {
  const parsed = contactLabelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Etiquetas inválidas.' };

  const session = await container.session.getCurrentSession();
  if (!can(session, 'contatos:escrever')) {
    return { ok: false, error: 'Seu papel não permite editar contatos.' };
  }

  const settings = await container.settings.get(session.account.id);
  const labels = settings.labels.filter((label) => parsed.data.labelIds.includes(label.id));

  try {
    const contact = await container.contacts.update(session.account.id, parsed.data.contactId, {
      labels,
    });
    // A conversa carrega uma cópia do contato: sem propagar, a tela mentiria.
    await container.conversations.syncContact(session.account.id, contact);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro ao etiquetar o contato.',
    };
  }

  // Etiqueta de contato também dispara: a regra "VIP → mover para Negociação"
  // deve valer quando a pessoa é marcada como VIP, não só a conversa.
  await dispararAutomacoes({
    accountId: session.account.id,
    trigger: 'etiqueta_aplicada',
    conversationId: parsed.data.conversationId,
  });

  await broadcast(parsed.data.conversationId);
  return { ok: true };
}

/* ==========================================================================
   Template HSM — a saída do bloqueio de 24h.
   ========================================================================== */

const templateSchema = z.object({
  conversationId: z.string().min(1).max(64),
  templateId: z.string().min(1).max(64),
  values: z.array(z.string().trim().max(300)).max(10),
});

export async function sendTemplateAction(input: unknown): Promise<SendMessageResult> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos para o template.' };

  const session = await container.session.getCurrentSession();
  const templates = await container.campaigns.listTemplates(session.account.id);
  const template = templates.find((item) => item.id === parsed.data.templateId);
  if (!template) return { ok: false, error: 'Template não encontrado.' };

  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );

  const result = await container.useCases.sendTemplate({
    session,
    conversationId: parsed.data.conversationId,
    template,
    values: parsed.data.values,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  let message = result.value;
  let dispatchError: string | undefined;

  if (conversation?.channel === 'whatsapp' && message.content.type === 'template') {
    const text = message.content.text;
    const channel = await getWhatsAppChannel();
    const channelStatus = await channel.getStatus(session.account.id, conversation.inboxId);

    if (channelStatus.status === 'conectado') {
      const sent = await channel.sendText(
        {
          accountId: session.account.id,
          conversationId: conversation.id,
          messageId: message.id,
          inboxId: conversation.inboxId,
        },
        { channelThreadId: conversation.channelThreadId, phone: conversation.contact.phone },
        text,
      );
      const applied = await applyDispatch(session.account.id, conversation.id, message, sent);
      message = applied.message;
      dispatchError = applied.error;
    } else {
      dispatchError = channelStatus.error ?? 'WhatsApp desconectado: o template não foi entregue.';
      message = { ...message, deliveryStatus: 'falha' };
    }
  }

  const updated = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  waEventBus.emitConversation({
    type: 'new_message',
    accountId: session.account.id,
    conversationId: parsed.data.conversationId,
    messageId: message.id,
    message,
    conversation: updated ?? undefined,
  });

  return dispatchError ? { ok: false, error: dispatchError, message } : { ok: true, message };
}

/* ==========================================================================
   Anexos de saída.
   ========================================================================== */

/** 16 MB é o teto prático do WhatsApp para mídia comum. */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Tipos aceitos por categoria.
 *
 * Lista de permissão, não de bloqueio: o arquivo será servido de volta pela
 * rota de mídia, e qualquer coisa fora desta lista sai como download forçado
 * em vez de ser renderizada. `document` aceita o resto por eliminação.
 */
const ALLOWED_MIME: Readonly<Record<MediaKind, readonly string[]>> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp'],
  audio: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/wav'],
  document: [
    'application/pdf',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ],
};

/** O parâmetro `codecs=` faz parte do tipo, mas não da comparação. */
const baseMimeOf = (value: string): string => (value.split(';')[0] ?? '').trim().toLowerCase();

const humanSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const secondsLabel = (seconds: number): string => {
  const whole = Math.max(1, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * Envia um anexo.
 *
 * Recebe `FormData` porque o arquivo nunca deve passar por base64 num payload
 * JSON: inflaria 33% e ainda teria de ser decodificado do outro lado.
 */
export async function sendMediaAction(form: FormData): Promise<SendMessageResult> {
  const conversationId = String(form.get('conversationId') ?? '');
  const kindRaw = String(form.get('kind') ?? '');
  const caption = String(form.get('caption') ?? '')
    .trim()
    .slice(0, 1024);
  const isPrivate = form.get('isPrivate') === 'true';
  const voice = form.get('voice') === 'true';
  const durationSeconds = Number(form.get('durationSeconds') ?? 0);
  const file = form.get('file');

  if (!conversationId || conversationId.length > 64) {
    return { ok: false, error: 'Conversa inválida.' };
  }
  if (!MEDIA_KINDS.includes(kindRaw as MediaKind)) {
    return { ok: false, error: 'Tipo de anexo inválido.' };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Nenhum arquivo recebido.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `O arquivo tem ${humanSize(file.size)}. O limite é ${humanSize(MAX_UPLOAD_BYTES)}.`,
    };
  }

  const kind = kindRaw as MediaKind;
  const mimeType = baseMimeOf(file.type) || 'application/octet-stream';
  if (!ALLOWED_MIME[kind].includes(mimeType)) {
    return { ok: false, error: `Arquivos do tipo ${mimeType} não são aceitos como ${kind}.` };
  }

  const session = await container.session.getCurrentSession();
  const conversation = await container.conversations.findById(
    session.account.id,
    conversationId,
    session.inboxAccess,
  );
  if (!conversation) return { ok: false, error: 'Conversa não encontrada.' };

  // Anexo público fora da janela HSM é tão bloqueado quanto texto livre.
  if (!isPrivate && !canSendFreeText(conversation)) {
    return {
      ok: false,
      error: 'Janela de 24h encerrada: envie um template aprovado antes de mandar anexos.',
    };
  }

  const data = Buffer.from(await file.arrayBuffer());
  const mediaId = `out-${randomUUID()}`;
  // O anexo enviado tambem vai para o Storage: e o que permite o worker — que
  // roda noutro processo, e pode rodar noutra maquina — ler os bytes que esta
  // requisicao acabou de receber.
  const url = await mediaStore.save(
    mediaId,
    data,
    { mimeType, fileName: file.name },
    { accountId: session.account.id, inboxId: conversation.inboxId, kind: 'mensagem' },
  );
  if (!url) return { ok: false, error: 'Não foi possível guardar o anexo.' };

  const content: MessageContent =
    kind === 'image'
      ? { type: 'image', url, ...(caption ? { caption } : {}) }
      : kind === 'video'
        ? { type: 'video', url, mimeType, ...(caption ? { caption } : {}) }
        : kind === 'audio'
          ? {
              type: 'audio',
              duration: secondsLabel(durationSeconds),
              url,
              mimeType,
              ...(voice ? { voice: true } : {}),
            }
          : {
              type: 'document',
              fileName: file.name || 'arquivo',
              size: humanSize(file.size),
              url,
            };

  const result = await container.useCases.sendMedia({
    session,
    conversationId,
    content,
    isPrivate,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  let message = result.value;
  let dispatchError: string | undefined;

  // Nota interna nunca sai para o canal externo — vale para anexo também.
  if (!isPrivate && conversation.channel === 'whatsapp') {
    const channel = await getWhatsAppChannel();
    const channelStatus = await channel.getStatus(session.account.id, conversation.inboxId);

    if (channelStatus.status === 'conectado') {
      // Só o identificador viaja para o canal: os bytes já estão no depósito
      // (`mediaStore.save` acima), e é de lá que os dois motores os leem.
      const sent = await channel.sendMedia(
        {
          accountId: session.account.id,
          conversationId: conversation.id,
          messageId: message.id,
          inboxId: conversation.inboxId,
        },
        { channelThreadId: conversation.channelThreadId, phone: conversation.contact.phone },
        {
          kind,
          mediaId,
          mimeType: file.type || mimeType,
          ...(file.name ? { fileName: file.name } : {}),
          ...(caption ? { caption } : {}),
          ...(voice ? { voice: true } : {}),
        },
      );
      const applied = await applyDispatch(session.account.id, conversation.id, message, sent);
      message = applied.message;
      dispatchError = applied.error;
    } else {
      dispatchError = channelStatus.error ?? 'WhatsApp desconectado: o anexo não foi entregue.';
      message = { ...message, deliveryStatus: 'falha' };
    }
  }

  const updated = await container.conversations.findById(
    session.account.id,
    conversationId,
    session.inboxAccess,
  );
  waEventBus.emitConversation({
    type: 'new_message',
    accountId: session.account.id,
    conversationId,
    messageId: message.id,
    message,
    conversation: updated ?? undefined,
  });

  return dispatchError ? { ok: false, error: dispatchError, message } : { ok: true, message };
}

/* ==========================================================================
   Mover o atendimento de caixa de entrada.
   ========================================================================== */

const moveInboxSchema = z.object({
  conversationId: z.string().min(1).max(64),
  inboxId: z.string().min(1).max(64),
});

/**
 * Move a conversa para outra caixa.
 *
 * Toda a regra vive no caso de uso — inclusive a decisão de desatribuir quem
 * não alcança a caixa de destino. Aqui só entra a validação da entrada e o
 * anúncio: a conversa muda de lugar, e as telas abertas precisam saber.
 *
 * O evento carrega a conversa já atualizada; quem estiver com a caixa de origem
 * aberta e não alcançar o destino simplesmente para de recebê-la — o filtro da
 * rota de SSE cuida disso.
 */
export async function moveConversationToInboxAction(input: unknown): Promise<ActionResult> {
  const parsed = moveInboxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos para mover a conversa.' };

  const session = await container.session.getCurrentSession();
  const result = await container.useCases.moveConversationInbox({
    session,
    conversationId: parsed.data.conversationId,
    targetInboxId: parsed.data.inboxId,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  waEventBus.emitConversation({
    type: 'conversation_updated',
    accountId: session.account.id,
    conversationId: parsed.data.conversationId,
    inboxId: parsed.data.inboxId,
    conversation: result.value,
  });

  return { ok: true };
}
