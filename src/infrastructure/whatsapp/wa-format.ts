import type { InboxConnectionStatus } from '@/core/domain/channel';
import { PhoneNumber } from '@/core/domain/contact';
import { horaLabel } from '@/lib/datetime';
import { userOf } from './wa-identity';
import type { WhatsAppConnectionStatus } from './whatsapp-events';

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

/**
 * Rótulo de hora da mensagem.
 *
 * O fuso é explícito porque este código roda no worker do Render, cujo relógio
 * é UTC: sem ele toda mensagem nascia com o rótulo 3 horas adiantado.
 */
export const timeLabel = (date: Date): string => horaLabel(date);

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

/** Bullets que o WhatsApp usa para mascarar números fora da agenda. */
const MASCARA_DE_NUMERO = /[∙•·‧・･*]/;

/**
 * Decide se um nome recebido do WhatsApp realmente identifica uma pessoa.
 * Números puros e números mascarados são ausência de nome, não uma etiqueta
 * que deva sobrescrever o cadastro do CRM.
 */
export const nomeUtilizavel = (nome: string | null | undefined): string | undefined => {
  const limpo = nome?.trim();
  if (!limpo || MASCARA_DE_NUMERO.test(limpo)) return undefined;

  const digitos = limpo.replace(/[\s()+.-]/g, '');
  if (/^\d{6,}$/.test(digitos)) return undefined;
  return limpo;
};

export const GROUP_METADATA_TTL_MS = 10 * 60 * 1000;
export const AVATAR_TTL_MS = 60 * 60 * 1000;
export const MAX_TRACKED_SENT_IDS = 500;
/** Acima disso a mídia não é baixada: a conversa não pode esperar um vídeo enorme. */
export const MAX_INLINE_MEDIA_BYTES = 16 * 1024 * 1024;

/**
 * Estado do socket traduzido para o estado da caixa.
 *
 * O canal tem quatro estados e o socket tem cinco: os três degraus do
 * pareamento (`gerando_qr`, `aguardando_leitura`, `conectando`) descrevem por
 * onde a conexão está passando, e para a tela de Configurações são a mesma
 * coisa — a caixa está pareando. `nao_configurado` não aparece aqui de
 * propósito: ele diz que o canal nunca foi montado, e uma caixa com sessão de
 * WhatsApp já passou desse ponto.
 */
export const inboxStatusFrom = (status: WhatsAppConnectionStatus): InboxConnectionStatus => {
  switch (status) {
    case 'conectado':
      return 'conectado';
    case 'gerando_qr':
    case 'aguardando_leitura':
    case 'conectando':
      return 'pareando';
    case 'desconectado':
      return 'desconectado';
    default: {
      const exaustivo: never = status;
      throw new Error(`Estado de WhatsApp não mapeado: ${String(exaustivo)}`);
    }
  }
};
