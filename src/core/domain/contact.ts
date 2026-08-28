import type { Channel } from './channel';
import type { Label } from './label';
import type { Id, IsoDateTime } from './shared';

/** Atributo personalizado exibido no painel de contexto e no perfil do contato. */
export interface CustomField {
  readonly label: string;
  readonly value: string;
}

export interface TimelineEvent {
  readonly id: Id;
  readonly type: 'conversa' | 'nota' | 'funil' | 'campanha' | 'cadastro';
  readonly title: string;
  readonly description?: string;
  readonly occurredAt: string;
}

/**
 * Um "contato" pode representar uma pessoa (1:1) ou um grupo de canal.
 * Grupos não possuem telefone proprio — a identificacao vem do canal.
 */
export type ContactKind = 'pessoa' | 'grupo';

export interface Contact {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  /** Telefone normalizado em E.164 (ver PhoneNumber). Vazio quando kind === 'grupo'. */
  readonly phone: string;
  readonly email?: string;
  readonly company?: string;
  readonly channel: Channel;
  readonly avatarTone: string;
  readonly location?: string;
  readonly timezone?: string;
  readonly ownerName?: string;
  readonly lastContactAt?: IsoDateTime;
  readonly lastContactLabel?: string;
  readonly labels: readonly Label[];
  readonly customFields: readonly CustomField[];
  readonly notes?: string;
  readonly timeline?: readonly TimelineEvent[];
  /** Pessoa (padrão) ou grupo. Grupos nunca entram na agenda de contatos. */
  readonly kind?: ContactKind;
  /** Foto de perfil resolvida no canal (WhatsApp), quando disponível. */
  readonly avatarUrl?: string;
  /** Número de participantes — so faz sentido para kind === 'grupo'. */
  readonly participantCount?: number;
}

export const isGroupContact = (contact: Pick<Contact, 'kind'>): boolean => contact.kind === 'grupo';

export const GROUP_ALLOWED_FIELD_LABEL = 'group_chat_enabled';

export const isGroupAllowedInChat = (contact: Pick<Contact, 'kind' | 'customFields'>): boolean => {
  if (contact.kind !== 'grupo') return true;
  return contact.customFields?.some(
    (field) => (field.label === GROUP_ALLOWED_FIELD_LABEL || field.label === 'Permitido no Chat') && field.value === 'true',
  ) ?? false;
};

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Value Object de telefone: garante E.164 na fronteira do domínio.
 * Entrada inválida nunca vira um Contact.
 */
export const PhoneNumber = {
  isValid(raw: string): boolean {
    return E164.test(PhoneNumber.normalize(raw));
  },
  normalize(raw: string): string {
    const digits = raw.replace(/[^\d+]/g, '');
    return digits.startsWith('+') ? digits : `+${digits}`;
  },
  /** Formatação brasileira para leitura: +55 11 98213-4470 */
  format(raw: string): string {
    if (!raw.trim()) return '';
    const value = PhoneNumber.normalize(raw);
    const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(value);
    if (!br) return value;
    return `+55 ${br[1]} ${br[2]}-${br[3]}`;
  },
} as const;
