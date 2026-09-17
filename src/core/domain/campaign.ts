import type { Id } from './shared';

export type CampaignStatus =
  'rascunho' | 'agendada' | 'em_andamento' | 'pausada' | 'concluida' | 'cancelada';

/** Estado de um destinatário, na ordem em que os recibos da Meta chegam. */
export type CampaignRecipientStatus =
  'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed';

export interface CampaignMetrics {
  readonly recipients: number;
  readonly queued: number;
  readonly sent: number;
  readonly delivered: number;
  readonly read: number;
  readonly replied: number;
  readonly failed: number;
}

/**
 * De onde saem os destinatários.
 *
 * Três origens, e não um construtor de filtros: quem dispara uma campanha
 * já tem a lista em mãos (importou um CSV, marcou uma etiqueta) ou quer
 * falar com a base inteira. Um filtro genérico seria um segundo "Contatos"
 * dentro de Campanhas.
 */
export type CampaignAudience =
  | { readonly kind: 'todos' }
  | { readonly kind: 'lista'; readonly batchId: Id; readonly name?: string }
  | { readonly kind: 'etiqueta'; readonly labelId: Id; readonly name?: string };

/** Campos do contato que podem preencher uma variável do template. */
export type CampaignContactField = 'nome' | 'primeiro_nome' | 'empresa' | 'telefone';

export const CAMPAIGN_CONTACT_FIELD_LABELS: Readonly<Record<CampaignContactField, string>> = {
  nome: 'Nome do contato',
  primeiro_nome: 'Primeiro nome',
  empresa: 'Empresa',
  telefone: 'Telefone',
};

/**
 * De onde sai cada `{{n}}` do template: um texto igual para todos ou um campo
 * de cada contato. O índice na lista é o `n - 1`.
 */
export type CampaignVariable =
  | { readonly source: 'texto'; readonly value: string }
  | { readonly source: 'campo'; readonly field: CampaignContactField };

export interface Campaign {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly status: CampaignStatus;
  readonly inboxId: Id;
  readonly inboxName: string;
  /** Número da caixa oficial, como a pessoa o reconhece. */
  readonly inboxPhone: string;
  readonly templateId: Id | null;
  readonly templateName: string;
  readonly templateBody: string;
  readonly audience: CampaignAudience;
  readonly audienceLabel: string;
  readonly variables: readonly CampaignVariable[];
  readonly rateLimit: number;
  readonly scheduledAt: string | null;
  readonly scheduledLabel: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly metrics: CampaignMetrics;
}

export interface CampaignRecipient {
  readonly id: Id;
  readonly contactId: Id | null;
  readonly name: string;
  readonly phone: string;
  readonly status: CampaignRecipientStatus;
  readonly error: string | null;
  readonly conversationId: Id | null;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly readAt: string | null;
  readonly repliedAt: string | null;
}

export type TemplateApprovalStatus = 'aprovado' | 'em_analise' | 'rejeitado';

export interface WhatsAppTemplate {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly body: string;
  readonly approval: TemplateApprovalStatus;
  readonly variables: readonly string[];
  /** Conta do WhatsApp Business dona do template. Nulo nos locais. */
  readonly wabaId?: string;
  readonly language?: string;
  readonly category?: string;
}

/** Uma origem de destinatários oferecida no assistente, já com a contagem. */
export interface CampaignAudienceOption {
  readonly audience: CampaignAudience;
  readonly label: string;
  readonly description: string;
  readonly contactCount: number;
}

/** Caixa da API oficial que pode disparar campanhas. */
export interface CampaignInbox {
  readonly id: Id;
  readonly name: string;
  readonly phone: string;
  readonly wabaId: string;
  readonly connected: boolean;
}

export interface Segment {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly description: string;
  readonly contactCount: number;
}

export const CAMPAIGN_STATUS_LABELS: Readonly<Record<CampaignStatus, string>> = {
  rascunho: 'Rascunho',
  agendada: 'Agendada',
  em_andamento: 'Em andamento',
  pausada: 'Pausada',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

export const CAMPAIGN_RECIPIENT_STATUS_LABELS: Readonly<Record<CampaignRecipientStatus, string>> = {
  queued: 'Na fila',
  sending: 'Enviando',
  sent: 'Enviado',
  delivered: 'Entregue',
  read: 'Lido',
  replied: 'Respondeu',
  failed: 'Falhou',
};

/** Transições que a tela oferece. O executor faz as demais (em andamento → concluída). */
export const canPauseCampaign = (status: CampaignStatus): boolean =>
  status === 'em_andamento' || status === 'agendada';
export const canResumeCampaign = (status: CampaignStatus): boolean => status === 'pausada';
export const canCancelCampaign = (status: CampaignStatus): boolean =>
  status === 'agendada' || status === 'em_andamento' || status === 'pausada';

/** Percentual seguro (evita divisão por zero em campanha ainda sem envios). */
export const rate = (part: number, total: number): number =>
  total <= 0 ? 0 : Math.round((part / total) * 100);

/** Preenche as variáveis {{n}} de um template com os valores informados. */
export const renderTemplate = (body: string, values: readonly string[]): string =>
  body.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => {
    const value = values[Number(index) - 1];
    return value ?? `{{${index}}}`;
  });

/** Quantas variáveis `{{n}}` o corpo tem (a maior numerada). */
export const templateVariableCount = (body: string): number =>
  Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])));

/**
 * Resolve as variáveis de uma campanha para um contato.
 *
 * Campo vazio vira o texto de reserva, e não uma variável em branco: a Meta
 * recusa parâmetro vazio, e "Olá ," no aparelho do cliente é pior que "Olá".
 */
export const resolveCampaignVariables = (
  variables: readonly CampaignVariable[],
  contact: { readonly name: string; readonly phone: string; readonly company?: string },
): string[] =>
  variables.map((variable) => {
    if (variable.source === 'texto') return variable.value.trim() || '-';
    switch (variable.field) {
      case 'nome':
        return contact.name.trim() || 'cliente';
      case 'primeiro_nome':
        return contact.name.trim().split(/\s+/)[0] || 'cliente';
      case 'empresa':
        return contact.company?.trim() || '-';
      case 'telefone':
        return contact.phone || '-';
    }
  });
