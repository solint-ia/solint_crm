import type { Id } from './shared';

/**
 * Canais suportados pela plataforma. Novo canal = nova entrada no registro (OCP).
 *
 * Hoje só há WhatsApp — é onde o produto está focado. Instagram, Webchat,
 * E-mail e Telegram já apareceram aqui, mas nenhum tinha implementação por
 * trás: eram opções que a tela oferecia e que não conectavam a coisa alguma.
 * Oferecer conexão que não existe é pior do que não oferecer, então saíram do
 * registro. Voltam quando houver motor que os atenda, uma entrada por vez.
 */
export const CHANNELS = ['whatsapp'] as const;
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
};

/** Descritor de segurança para linha antiga do banco num canal já removido. */
const CANAL_DESCONHECIDO: ChannelDescriptor = {
  id: 'whatsapp',
  label: 'Canal desativado',
  tone: 'slate',
};

/**
 * O banco pode conter canal que o registro não tem mais.
 *
 * Linhas gravadas quando Instagram e Webchat ainda eram opções continuam lá, e
 * um acesso direto ao registro devolveria `undefined` — a tela quebrava ao ler
 * `.label` de uma conversa antiga. Aqui elas aparecem como desativadas, que é a
 * verdade, em vez de derrubar a página.
 */
export const describeChannel = (channel: Channel): ChannelDescriptor =>
  CHANNEL_REGISTRY[channel] ?? CANAL_DESCONHECIDO;

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
