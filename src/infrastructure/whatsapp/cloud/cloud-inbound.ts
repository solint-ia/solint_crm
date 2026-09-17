import type { MessageContent } from '@/core/domain/message';

/**
 * Mensagem da Meta traduzida para o que o CRM grava.
 *
 * Função pura: não baixa mídia, não consulta banco. Quem processa o evento usa
 * o resultado para resolver identidade, baixar o anexo e chamar
 * `commitMessage` — o mesmo funil do QR Code.
 */

type Obj = Record<string, unknown>;
const isObj = (valor: unknown): valor is Obj =>
  Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const str = (valor: unknown): string | undefined =>
  typeof valor === 'string' && valor.trim() ? valor : undefined;

export type CloudMediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface CloudInboundMedia {
  readonly kind: CloudMediaKind;
  /** Id da mídia na Meta. Vale 7 dias a partir do webhook. */
  readonly metaMediaId: string;
  readonly mimeType: string;
  readonly caption?: string;
  readonly fileName?: string;
  readonly voice?: boolean;
  readonly animated?: boolean;
}

export interface CloudInboundMessage {
  readonly wamid: string;
  readonly at: Date;
  readonly fromMe: boolean;
  /** E.164 com `+`, ou vazio quando a Meta mandou só o BSUID. */
  readonly phone: string;
  readonly userId?: string;
  readonly profileName?: string;
  /** Conteúdo sem a mídia: vira o conteúdo final se o download falhar. */
  readonly content: MessageContent;
  readonly preview: string;
  readonly media?: CloudInboundMedia;
  readonly quotedWamid?: string;
  readonly reaction?: { readonly targetWamid: string; readonly emoji: string };
  /** Anúncio click-to-WhatsApp que originou a conversa. */
  readonly referral?: Obj;
  /** O tipo cru da Meta, para o corpo do n8n e para diagnóstico. */
  readonly rawType: string;
}

const asText = (text: string): { content: MessageContent; preview: string } => ({
  content: { type: 'text', text },
  preview: text,
});

const asLabel = (label: string, extra?: string): { content: MessageContent; preview: string } =>
  asText(extra?.trim() ? `${label} · ${extra.trim()}` : label);

export const phoneFromWaId = (waId: string | undefined): string => {
  const digits = (waId ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
};

const timestampOf = (valor: unknown): Date => {
  const segundos = Number(valor);
  return Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date();
};

/**
 * Traduz `messages[]` (cliente escreveu) ou `message_echoes[]` (a empresa
 * escreveu pelo app, na coexistência).
 *
 * Devolve `null` para o que não vira bolha: mensagem `system` (troca de número)
 * sem texto útil e reação — reação volta em `reaction`, e quem chama aplica
 * sobre a mensagem reagida em vez de gravar uma linha nova.
 */
export const translateCloudMessage = (
  message: Obj,
  options: { readonly fromMe: boolean; readonly contact?: Obj },
): CloudInboundMessage | null => {
  const wamid = str(message['id']);
  if (!wamid) return null;
  const type = str(message['type']) ?? 'unknown';
  const contact = options.contact;
  const profile = isObj(contact?.['profile']) ? contact['profile'] : undefined;

  const waId = options.fromMe
    ? str(message['to'])
    : (str(message['from']) ?? str(contact?.['wa_id']));
  const userId = options.fromMe
    ? str(message['to_user_id'])
    : (str(message['from_user_id']) ?? str(contact?.['user_id']));

  const context = isObj(message['context']) ? message['context'] : undefined;
  const base = {
    wamid,
    at: timestampOf(message['timestamp']),
    fromMe: options.fromMe,
    phone: phoneFromWaId(waId),
    ...(userId ? { userId } : {}),
    ...(str(profile?.['name']) ? { profileName: str(profile?.['name']) } : {}),
    ...(str(context?.['id']) ? { quotedWamid: str(context?.['id']) } : {}),
    ...(isObj(message['referral']) ? { referral: message['referral'] } : {}),
    rawType: type,
  };

  const corpo = isObj(message[type]) ? (message[type] as Obj) : {};

  switch (type) {
    case 'text': {
      const text = str(corpo['body']) ?? '';
      return { ...base, ...asText(text) };
    }
    case 'image': {
      const caption = str(corpo['caption'])?.trim();
      return {
        ...base,
        ...asLabel('📷 Foto', caption),
        preview: caption ? `📷 ${caption}` : '📷 Foto',
        media: {
          kind: 'image',
          metaMediaId: str(corpo['id']) ?? '',
          mimeType: str(corpo['mime_type']) ?? 'image/jpeg',
          ...(caption ? { caption } : {}),
        },
      };
    }
    case 'video': {
      const caption = str(corpo['caption'])?.trim();
      return {
        ...base,
        ...asLabel('🎬 Vídeo', caption),
        media: {
          kind: 'video',
          metaMediaId: str(corpo['id']) ?? '',
          mimeType: str(corpo['mime_type']) ?? 'video/mp4',
          ...(caption ? { caption } : {}),
        },
      };
    }
    case 'audio': {
      const voice = corpo['voice'] === true;
      return {
        ...base,
        content: { type: 'audio', duration: '0:00', voice },
        preview: voice ? '🎤 Áudio' : '🎵 Áudio',
        media: {
          kind: 'audio',
          metaMediaId: str(corpo['id']) ?? '',
          mimeType: str(corpo['mime_type']) ?? 'audio/ogg',
          voice,
        },
      };
    }
    case 'document': {
      const fileName = str(corpo['filename'])?.trim() || 'documento';
      const caption = str(corpo['caption'])?.trim();
      return {
        ...base,
        content: { type: 'document', fileName, size: '—' },
        preview: `📎 ${fileName}`,
        media: {
          kind: 'document',
          metaMediaId: str(corpo['id']) ?? '',
          mimeType: str(corpo['mime_type']) ?? 'application/octet-stream',
          fileName,
          ...(caption ? { caption } : {}),
        },
      };
    }
    case 'sticker': {
      return {
        ...base,
        ...asLabel('🩹 Figurinha'),
        media: {
          kind: 'sticker',
          metaMediaId: str(corpo['id']) ?? '',
          mimeType: str(corpo['mime_type']) ?? 'image/webp',
          animated: corpo['animated'] === true,
        },
      };
    }
    case 'location': {
      const nome = str(corpo['name']) ?? str(corpo['address']);
      const lat = corpo['latitude'];
      const lng = corpo['longitude'];
      const coords =
        typeof lat === 'number' && typeof lng === 'number'
          ? `https://maps.google.com/?q=${lat},${lng}`
          : undefined;
      return { ...base, ...asLabel('📍 Localização', [nome, coords].filter(Boolean).join(' · ')) };
    }
    case 'contacts': {
      const lista = Array.isArray(message['contacts']) ? (message['contacts'] as unknown[]) : [];
      const primeiro = lista.find(isObj);
      const nome = isObj(primeiro?.['name']) ? str(primeiro['name']['formatted_name']) : undefined;
      return lista.length > 1
        ? { ...base, ...asLabel(`👥 ${lista.length} contatos compartilhados`) }
        : { ...base, ...asLabel('👤 Contato', nome) };
    }
    case 'interactive': {
      const resposta =
        (isObj(corpo['button_reply']) ? str(corpo['button_reply']['title']) : undefined) ??
        (isObj(corpo['list_reply']) ? str(corpo['list_reply']['title']) : undefined) ??
        (isObj(corpo['nfm_reply']) ? 'Formulário respondido' : undefined);
      return { ...base, ...asText(resposta ?? 'Resposta interativa') };
    }
    case 'button': {
      return { ...base, ...asText(str(corpo['text']) ?? str(corpo['payload']) ?? 'Botão') };
    }
    case 'reaction': {
      const alvo = str(corpo['message_id']);
      if (!alvo) return null;
      return {
        ...base,
        ...asText(''),
        reaction: {
          targetWamid: alvo,
          emoji: typeof corpo['emoji'] === 'string' ? corpo['emoji'] : '',
        },
      };
    }
    case 'order': {
      return { ...base, ...asLabel('🛒 Pedido do catálogo') };
    }
    case 'system': {
      const texto = str(corpo['body']);
      return texto ? { ...base, content: { type: 'system', text: texto }, preview: texto } : null;
    }
    default: {
      // `unsupported` inclui visualização única, enquete e o que a Meta ainda
      // não entrega pela API. Gravar o aviso é melhor que perder a mensagem: o
      // atendente sabe que o cliente mandou algo e pode pedir de outro jeito.
      return {
        ...base,
        ...asText('⚠️ Mensagem não suportada pela API oficial do WhatsApp'),
      };
    }
  }
};

/** Status da Meta traduzido para o do CRM. */
export const deliveryStatusFromCloud = (
  status: string | undefined,
): 'enviado' | 'entregue' | 'lido' | 'falha' | undefined => {
  switch (status) {
    case 'sent':
      return 'enviado';
    case 'delivered':
      return 'entregue';
    case 'read':
    case 'played':
      return 'lido';
    case 'failed':
      return 'falha';
    default:
      return undefined;
  }
};
