import type { Channel } from '@/core/domain/channel';
import { CHANNEL_REGISTRY } from '@/core/domain/channel';
import type { ConversationStatus, Priority } from '@/core/domain/conversation';
import type { Tone } from '@/core/domain/label';
import type { CampaignStatus } from '@/core/domain/campaign';
import type { InboxConnectionStatus } from '@/core/domain/channel';

/**
 * Traducao de estado de dominio -> tom visual.
 * Centralizada para que a leitura de cor seja consistente em todas as telas.
 */
export const STATUS_TONE: Readonly<Record<ConversationStatus, Tone>> = {
  aberta: 'blue',
  pendente: 'amber',
  resolvida: 'slate',
  espera: 'violet',
};

export const STATUS_LABEL: Readonly<Record<ConversationStatus, string>> = {
  aberta: 'Aberta',
  pendente: 'Pendente',
  resolvida: 'Resolvida',
  espera: 'Em espera',
};

export const PRIORITY_TONE: Readonly<Record<Priority, Tone>> = {
  baixa: 'slate',
  media: 'blue',
  alta: 'amber',
  urgente: 'red',
};

export const PRIORITY_LABEL: Readonly<Record<Priority, string>> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  urgente: 'Urgente',
};

export const CHANNEL_TONE = (channel: Channel): Tone => CHANNEL_REGISTRY[channel].tone;

export const CHANNEL_COLOR_VAR: Readonly<Record<Channel, string>> = {
  whatsapp: 'var(--color-whatsapp)',
  instagram: 'var(--color-instagram)',
  webchat: 'var(--color-webchat)',
  email: 'var(--color-email)',
  telegram: 'var(--color-telegram)',
};

export const CAMPAIGN_STATUS_TONE: Readonly<Record<CampaignStatus, Tone>> = {
  rascunho: 'slate',
  agendada: 'violet',
  em_andamento: 'blue',
  pausada: 'amber',
  concluida: 'green',
  cancelada: 'red',
};

export const CONNECTION_STATUS_TONE: Readonly<Record<InboxConnectionStatus, Tone>> = {
  conectado: 'green',
  pareando: 'amber',
  desconectado: 'red',
  nao_configurado: 'slate',
};

export const CONNECTION_STATUS_LABEL: Readonly<Record<InboxConnectionStatus, string>> = {
  conectado: 'Conectado',
  pareando: 'Pareando',
  desconectado: 'Desconectado',
  nao_configurado: 'Não conectado',
};
