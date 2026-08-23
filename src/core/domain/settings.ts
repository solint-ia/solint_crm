import type { AutoReply, BusinessHours } from './business-hours';
import type { Channel, InboxConnectionStatus } from './channel';
import type { Id } from './shared';

export interface Macro {
  readonly id: Id;
  readonly name: string;
  readonly steps: string;
}

export interface CannedResponse {
  readonly id: Id;
  readonly shortcut: string;
  readonly content: string;
}

export type AssignmentMethod = 'round_robin' | 'balanceada' | 'manual';

export const ASSIGNMENT_METHOD_LABELS: Readonly<Record<AssignmentMethod, string>> = {
  round_robin: 'Round-robin (sequencial)',
  balanceada: 'Balanceada por carga',
  manual: 'Manual (agentes assumem da fila)',
};

/**
 * Uma caixa de entrada conectada.
 *
 * Conexão e operação moram juntas de propósito: quem abre a caixa quer saber,
 * na mesma tela, se ela está online E se está dentro do expediente. Separar as
 * duas coisas obrigaria o supervisor a cruzar telas para responder "por que o
 * cliente recebeu a mensagem de ausência às 15h?".
 */
export interface ChannelConnection {
  readonly id: Id;
  readonly name: string;
  readonly channel: Channel;
  readonly identifier: string;
  readonly status: InboxConnectionStatus;
  readonly provider: string;
  readonly businessHours: BusinessHours;
  /** Disparada quando chega mensagem fora do expediente. */
  readonly awayMessage: AutoReply;
  /** Disparada na primeira mensagem de uma conversa nova. */
  readonly greeting: AutoReply;
  /** Endpoint que recebe os eventos desta caixa. Vazio = sem webhook. */
  readonly webhookUrl?: string;
  /** Agentes que atendem esta caixa. */
  readonly teamName?: string;
}

export interface Webhook {
  readonly id: Id;
  readonly url: string;
  readonly events: readonly string[];
  readonly enabled: boolean;
}

export interface ApiToken {
  readonly id: Id;
  readonly name: string;
  /** Somente os últimos caracteres são exibidos — o segredo nunca volta do servidor. */
  readonly maskedValue: string;
  readonly createdLabel: string;
  readonly lastUsedLabel: string;
}

export interface Team {
  readonly id: Id;
  readonly name: string;
  readonly memberCount: number;
  readonly inboxes: readonly string[];
  readonly businessHours: string;
}

export interface CustomAttributeDefinition {
  readonly id: Id;
  readonly name: string;
  readonly key: string;
  readonly type: 'texto' | 'numero' | 'data' | 'lista' | 'booleano';
  readonly appliesTo: 'contato' | 'conversa';
}

export interface AuditLogEntry {
  readonly id: Id;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly ip: string;
  readonly at: string;
}

export interface ActiveSession {
  readonly id: Id;
  readonly device: string;
  readonly location: string;
  readonly lastActive: string;
  readonly current: boolean;
}

export interface BillingInfo {
  readonly planName: string;
  readonly priceLabel: string;
  readonly renewalLabel: string;
  readonly usage: readonly { readonly label: string; readonly used: number; readonly limit: number }[];
  readonly invoices: readonly {
    readonly id: Id;
    readonly reference: string;
    readonly amountLabel: string;
    readonly status: 'paga' | 'aberta' | 'vencida';
  }[];
}
