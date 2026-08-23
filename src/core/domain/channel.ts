import type { Id } from './shared';

/** Canais suportados pela plataforma. Novo canal = nova entrada no registro (OCP). */
export const CHANNELS = ['whatsapp', 'instagram', 'webchat', 'email', 'telegram'] as const;
export type Channel = (typeof CHANNELS)[number];

export type ChannelToneKey = 'green' | 'pink' | 'indigo' | 'slate' | 'blue';

export interface ChannelDescriptor {
  readonly id: Channel;
  readonly label: string;
  /** Token de cor de marca do canal (classe utilitária de tema). */
  readonly tone: ChannelToneKey;
}

/**
 * Registro único de canais. A UI nunca faz `switch (channel)`:
 * consulta este registro, de modo que adicionar um canal não altera componentes.
 */
export const CHANNEL_REGISTRY: Readonly<Record<Channel, ChannelDescriptor>> = {
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', tone: 'green' },
  instagram: { id: 'instagram', label: 'Instagram', tone: 'pink' },
  webchat: { id: 'webchat', label: 'Webchat', tone: 'indigo' },
  email: { id: 'email', label: 'E-mail', tone: 'slate' },
  telegram: { id: 'telegram', label: 'Telegram', tone: 'blue' },
};

export const describeChannel = (channel: Channel): ChannelDescriptor => CHANNEL_REGISTRY[channel];

export type InboxConnectionStatus = 'conectado' | 'desconectado' | 'pareando' | 'nao_configurado';

/** Caixa de entrada: uma conexão concreta de um canal com a conta. */
export interface Inbox {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly channel: Channel;
  readonly identifier: string;
  readonly status: InboxConnectionStatus;
  readonly provider?: 'cloud_api' | 'baileys' | 'evolution' | 'nativo';
}
