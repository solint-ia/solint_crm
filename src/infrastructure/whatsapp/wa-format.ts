import { PhoneNumber } from '@/core/domain/contact';
import { userOf } from './wa-identity';

/**
 * Constantes e formatadores compartilhados pelos dois motores de WhatsApp.
 *
 * O serviço in-process (`whatsapp-service.ts`) e a sessão do worker
 * (`worker/session.ts`) mantinham cópias literais deste código. Duas cópias de
 * uma regra é uma cópia a mais: quando uma muda e a outra não, o mesmo contato
 * ganha cores diferentes, ou um código de desconexão passa a ser tratado só em
 * metade do sistema — e a diferença aparece em produção, não em revisão.
 */

const AVATAR_TONES = ['#168cff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

/** Tom estável por chave: o mesmo contato mantém a mesma cor entre reinícios. */
export const toneFor = (key: string): string => {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length] as string;
};

export const timeLabel = (date: Date): string =>
  date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Código de desconexão do Baileys.
 *
 * O erro chega em três formatos diferentes conforme a camada que o produziu
 * (Boom, erro de socket, erro cru), e é o código que decide entre reconectar,
 * pedir QR novo ou apagar a sessão. Ler só um dos formatos fazia o serviço
 * tratar uma desconexão comum como se fosse logout.
 */
export const extractStatusCode = (error: unknown): number | undefined => {
  if (!error) return undefined;
  const err = error as Record<string, unknown>;
  const output = err['output'] as Record<string, unknown> | undefined;
  if (output && typeof output['statusCode'] === 'number') {
    return output['statusCode'];
  }
  if (typeof err['statusCode'] === 'number') return err['statusCode'];
  if (typeof err['code'] === 'number') return err['code'];
  return undefined;
};

/** Nome legível de um contato pessoal quando o próprio `pushName` não veio. */
export const fallbackPersonName = (phone: string, jid: string): string =>
  phone ? PhoneNumber.format(phone) : `Contato ${userOf(jid).slice(-6)}`;

export const GROUP_METADATA_TTL_MS = 10 * 60 * 1000;
export const AVATAR_TTL_MS = 60 * 60 * 1000;
export const MAX_TRACKED_SENT_IDS = 500;
/** Acima disso a mídia não é baixada: a conversa não pode esperar um vídeo enorme. */
export const MAX_INLINE_MEDIA_BYTES = 16 * 1024 * 1024;
