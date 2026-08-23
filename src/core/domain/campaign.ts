import type { Id } from './shared';

export type CampaignStatus =
  | 'rascunho'
  | 'agendada'
  | 'em_andamento'
  | 'pausada'
  | 'concluida'
  | 'cancelada';

export interface CampaignMetrics {
  readonly recipients: number;
  readonly sent: number;
  readonly delivered: number;
  readonly read: number;
  readonly failed: number;
}

export interface Campaign {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly status: CampaignStatus;
  readonly segmentName: string;
  readonly templateName: string;
  readonly scheduledLabel: string;
  readonly metrics: CampaignMetrics;
}

export type TemplateApprovalStatus = 'aprovado' | 'em_analise' | 'rejeitado';

export interface WhatsAppTemplate {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly body: string;
  readonly approval: TemplateApprovalStatus;
  readonly variables: readonly string[];
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

/** Percentual seguro (evita divisão por zero em campanha ainda sem envios). */
export const rate = (part: number, total: number): number =>
  total <= 0 ? 0 : Math.round((part / total) * 100);

/** Preenche as variáveis {{n}} de um template com os valores informados. */
export const renderTemplate = (body: string, values: readonly string[]): string =>
  body.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => {
    const value = values[Number(index) - 1];
    return value ?? `{{${index}}}`;
  });
