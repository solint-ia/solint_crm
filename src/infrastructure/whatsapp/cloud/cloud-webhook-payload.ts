import type {
  SolintRefs,
  WebhookPayloadEmMontagem,
} from '@/infrastructure/webhooks/webhook-dispatch';
import type { CloudInboundMessage } from './cloud-inbound';
import { BSUID_THREAD_PREFIX } from './cloud-sender';

/**
 * O corpo entregue ao n8n para uma caixa da API oficial.
 *
 * **No mesmo formato das caixas de QR Code.** Os fluxos do n8n já leem
 * `data.key.remoteJid`, `data.message.conversation`, `data.message.audioMessage`
 * e `solint.*`. Entregar o JSON da Meta cru obrigaria cada cliente a refazer o
 * fluxo no dia em que migrasse de número. Aqui a mensagem da Meta vira a forma
 * da `WAMessage` do Baileys, e o original vai junto em `data.cloud` para quem
 * quiser o que não tem equivalente.
 *
 * Sem importar o Baileys: só a forma do objeto importa.
 */

type Obj = Record<string, unknown>;
const isObj = (valor: unknown): valor is Obj =>
  Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

export const cloudRemoteJid = (msg: Pick<CloudInboundMessage, 'phone' | 'userId'>): string =>
  msg.phone
    ? `${msg.phone.replace(/\D/g, '')}@s.whatsapp.net`
    : `${BSUID_THREAD_PREFIX}${msg.userId ?? ''}`;

const conteudoBaileys = (
  msg: CloudInboundMessage,
  raw: Obj,
): { readonly message: Obj; readonly messageType: string } => {
  const corpo = isObj(raw[msg.rawType]) ? (raw[msg.rawType] as Obj) : {};
  const contextInfo = msg.quotedWamid ? { stanzaId: msg.quotedWamid, participant: '' } : undefined;
  const comContexto = (objeto: Obj): Obj => (contextInfo ? { ...objeto, contextInfo } : objeto);

  switch (msg.rawType) {
    case 'text': {
      const text = msg.content.type === 'text' ? msg.content.text : msg.preview;
      return contextInfo
        ? {
            message: { extendedTextMessage: { text, contextInfo } },
            messageType: 'extendedTextMessage',
          }
        : { message: { conversation: text }, messageType: 'conversation' };
    }
    case 'image':
      return {
        message: {
          imageMessage: comContexto({
            ...(msg.media?.caption ? { caption: msg.media.caption } : {}),
            mimetype: msg.media?.mimeType ?? 'image/jpeg',
          }),
        },
        messageType: 'imageMessage',
      };
    case 'video':
      return {
        message: {
          videoMessage: comContexto({
            ...(msg.media?.caption ? { caption: msg.media.caption } : {}),
            mimetype: msg.media?.mimeType ?? 'video/mp4',
          }),
        },
        messageType: 'videoMessage',
      };
    case 'audio':
      return {
        message: {
          audioMessage: comContexto({
            mimetype: msg.media?.mimeType ?? 'audio/ogg',
            ptt: Boolean(msg.media?.voice),
          }),
        },
        messageType: 'audioMessage',
      };
    case 'document':
      return {
        message: {
          documentMessage: comContexto({
            fileName: msg.media?.fileName ?? 'documento',
            mimetype: msg.media?.mimeType ?? 'application/octet-stream',
            ...(msg.media?.caption ? { caption: msg.media.caption } : {}),
          }),
        },
        messageType: 'documentMessage',
      };
    case 'sticker':
      return {
        message: {
          stickerMessage: comContexto({
            mimetype: msg.media?.mimeType ?? 'image/webp',
            isAnimated: Boolean(msg.media?.animated),
          }),
        },
        messageType: 'stickerMessage',
      };
    case 'location':
      return {
        message: {
          locationMessage: {
            degreesLatitude: corpo['latitude'],
            degreesLongitude: corpo['longitude'],
            ...(typeof corpo['name'] === 'string' ? { name: corpo['name'] } : {}),
            ...(typeof corpo['address'] === 'string' ? { address: corpo['address'] } : {}),
          },
        },
        messageType: 'locationMessage',
      };
    case 'interactive': {
      const botao = isObj(corpo['button_reply']) ? corpo['button_reply'] : undefined;
      const lista = isObj(corpo['list_reply']) ? corpo['list_reply'] : undefined;
      if (botao) {
        return {
          message: {
            buttonsResponseMessage: {
              selectedButtonId: botao['id'],
              selectedDisplayText: botao['title'],
            },
          },
          messageType: 'buttonsResponseMessage',
        };
      }
      if (lista) {
        return {
          message: {
            listResponseMessage: {
              title: lista['title'],
              singleSelectReply: { selectedRowId: lista['id'] },
            },
          },
          messageType: 'listResponseMessage',
        };
      }
      return { message: { conversation: msg.preview }, messageType: 'conversation' };
    }
    case 'button':
      return {
        message: {
          templateButtonReplyMessage: {
            selectedId: corpo['payload'],
            selectedDisplayText: corpo['text'],
          },
        },
        messageType: 'templateButtonReplyMessage',
      };
    case 'reaction':
      return {
        message: {
          reactionMessage: {
            key: { id: msg.reaction?.targetWamid },
            text: msg.reaction?.emoji ?? '',
          },
        },
        messageType: 'reactionMessage',
      };
    default:
      return { message: { conversation: msg.preview }, messageType: 'conversation' };
  }
};

export interface CloudUpsertPayloadInput {
  readonly msg: CloudInboundMessage;
  /** A mensagem como a Meta mandou. */
  readonly raw: Obj;
  readonly instance: string;
  readonly instanceId: string;
  /** Número da caixa, em E.164 ou só dígitos. */
  readonly businessPhone: string;
  readonly solint: SolintRefs;
  readonly base64?: string;
  readonly mediaUrl?: string;
}

export const buildCloudUpsertPayload = (
  entrada: CloudUpsertPayloadInput,
): WebhookPayloadEmMontagem => {
  const { msg } = entrada;
  const { message, messageType } = conteudoBaileys(msg, entrada.raw);
  const tipoMidia = Object.keys(message)[0];
  if (entrada.base64 && tipoMidia && isObj(message[tipoMidia])) {
    // Mesmo lugar do QR Code: `message.base64` ao lado do conteúdo.
    (message as Obj)['base64'] = entrada.base64;
  }

  return {
    event: 'messages.upsert',
    instance: entrada.instance,
    data: {
      key: {
        remoteJid: cloudRemoteJid(msg),
        fromMe: msg.fromMe,
        id: msg.wamid,
        participant: '',
        ...(msg.userId ? { userId: msg.userId } : {}),
      },
      ...(msg.profileName ? { pushName: msg.profileName } : {}),
      message,
      contextInfo: msg.quotedWamid
        ? { stanzaId: msg.quotedWamid, participant: '' }
        : msg.referral
          ? { externalAdReply: msg.referral }
          : null,
      messageType,
      messageTimestamp: Math.floor(msg.at.getTime() / 1000),
      instanceId: entrada.instanceId,
      source: 'cloud_api',
      ...(entrada.mediaUrl ? { mediaUrl: entrada.mediaUrl } : {}),
      cloud: entrada.raw,
    } as WebhookPayloadEmMontagem['data'],
    date_time: new Date().toISOString(),
    sender: `${entrada.businessPhone.replace(/\D/g, '')}@s.whatsapp.net`,
    solint: entrada.solint,
  };
};
