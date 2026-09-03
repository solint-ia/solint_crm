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

/**
 * Um telefone de sócio, com a classificação que a origem deu **àquele número**.
 *
 * A classificação é do telefone, não da pessoa: na planilha de prospecção o
 * mesmo sócio aparece com `D` num número e `C2` noutro. Guardá-la no sócio
 * perderia essa distinção, que é exatamente o critério por onde quem prospecta
 * escolhe para qual número ligar primeiro.
 */
export interface ContactPartnerPhone {
  /** E.164. Também está em `phone`/`extraPhones` do contato — ver `ContactPartner`. */
  readonly phone: string;
  readonly classification?: string;
}

/**
 * Um sócio da empresa e os telefones dele.
 *
 * **Por que isto existe.** A planilha B2B vem com uma linha por número, e uma
 * empresa costuma ter vários sócios, cada um com vários telefones. Tudo isso
 * era achatado num contato só, com um `partnerPhone` e uma `classification`: o
 * primeiro número encontrado ficava, o resto virava `extraPhones` sem dono e
 * sem classificação, e não havia como saber de quem era cada um. Quem ia
 * conversar via uma lista de números soltos e tinha que adivinhar.
 *
 * Os números continuam **também** em `phone`/`extraPhones`, e não só aqui. Essa
 * duplicação é deliberada: aquelas duas colunas são as consultáveis (a
 * importação procura contato existente por elas, e o envio valida o
 * destinatário contra elas), enquanto esta estrutura é lida e gravada inteira e
 * responde outra pergunta — de quem é o número, e com qual classificação.
 */
export interface ContactPartner {
  readonly name: string;
  readonly phones: readonly ContactPartnerPhone[];
}

export interface Contact {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  /** Telefone normalizado em E.164 (ver PhoneNumber). Vazio quando kind === 'grupo'. */
  readonly phone: string;
  /**
   * Outros números da mesma pessoa, em E.164, sem repetir `phone`.
   *
   * Uma conversa continua saindo por `phone` — ela tem um destinatário só, e
   * escolher sozinho qual número usar seria decidir no lugar de quem atende.
   * Estes ficam à vista no cadastro para que a escolha seja possível.
   */
  readonly extraPhones?: readonly string[];
  readonly email?: string;
  readonly company?: string;
  readonly cnpj?: string;
  readonly companyAddress?: string;
  readonly companyPhone?: string;
  /** Telefone do sócio principal — o primeiro da planilha. Ver `partners`. */
  readonly partnerPhone?: string;
  /** Classificação geral quando há um só contato de sócio. Ver `partners`. */
  readonly classification?: string;
  /** Sócios da empresa e os telefones de cada um. Vazio fora da importação B2B. */
  readonly partners?: readonly ContactPartner[];
  /** Como entrou na base. Não se confunde com `kind` (pessoa/grupo). */
  readonly origin?: 'manual' | 'csv' | 'whatsapp';
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

/** Resumo suficiente para navegar pelas listas importadas sem nova requisição. */
export interface ContactImportBatchSummary {
  readonly id: Id;
  readonly name: string;
  readonly createdAt: IsoDateTime;
  readonly contactCount: number;
  readonly contactIds: readonly Id[];
}

export const isGroupContact = (contact: Pick<Contact, 'kind'>): boolean => contact.kind === 'grupo';

export const GROUP_ALLOWED_FIELD_LABEL = 'group_chat_enabled';

/**
 * As caixas cujo número participa deste grupo.
 *
 * **Por que precisa existir.** O contato de grupo é da *conta*
 * (`ct-wa-<conta>-g-<id>`), mas participar de um grupo é do *número*. Sem este
 * campo o CRM oferecia todas as caixas de WhatsApp para qualquer grupo — e
 * escolher um número que não é membro fazia o WhatsApp recusar o envio com
 * `not-authorized`, já com a mensagem gravada na conversa. Só a caixa que havia
 * sincronizado os grupos funcionava, e não havia nada na tela explicando por quê.
 *
 * Guardado como lista separada por vírgula porque um grupo pode ter mais de um
 * número da mesma conta entre os participantes.
 */
export const GROUP_INBOXES_FIELD_LABEL = 'group_inbox_ids';

/** As caixas que participam do grupo. Vazio = desconhecido, não "nenhuma". */
export const groupInboxIds = (contact: Pick<Contact, 'customFields'>): readonly string[] =>
  contact.customFields
    ?.find((field) => field.label === GROUP_INBOXES_FIELD_LABEL)
    ?.value.split(',')
    .map((id) => id.trim())
    .filter(Boolean) ?? [];

export const isGroupAllowedInChat = (contact: Pick<Contact, 'kind' | 'customFields'>): boolean => {
  if (contact.kind !== 'grupo') return true;
  return (
    contact.customFields?.some(
      (field) =>
        (field.label === GROUP_ALLOWED_FIELD_LABEL || field.label === 'Permitido no Chat') &&
        field.value === 'true',
    ) ?? false
  );
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
