import type { Priority } from './conversation';
import type { Id } from './shared';

export interface PipelineStage {
  readonly id: Id;
  readonly pipelineId: Id;
  readonly name: string;
  readonly order: number;
  readonly color: string;
  readonly isWon: boolean;
  readonly isLost: boolean;
  readonly defaultProbability?: number;
}

export interface Pipeline {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly stages: readonly PipelineStage[];
}

export interface DealHistoryEntry {
  readonly text: string;
  readonly date: string;
}

export interface DealTask {
  readonly id: Id;
  readonly title: string;
  readonly completed: boolean;
  readonly dueDate?: string;
}

export type DealSource =
  | 'whatsapp'
  | 'instagram'
  | 'site'
  | 'indicacao'
  | 'google'
  | 'inbound'
  | 'outbound';

export const DEAL_SOURCES: readonly { readonly id: DealSource; readonly label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'site', label: 'Website / Inbound' },
  { id: 'indicacao', label: 'Indicação' },
  { id: 'google', label: 'Google Ads' },
  { id: 'inbound', label: 'Formulário' },
  { id: 'outbound', label: 'Prospecção Ativa' },
];

/** Oportunidade (card do funil). */
export interface Deal {
  readonly id: Id;
  readonly accountId: Id;
  readonly pipelineId: Id;
  readonly stageId: Id;
  readonly contactId?: Id;
  readonly contactName: string;
  readonly title?: string;
  readonly company?: string;
  /** Valor em centavos — dinheiro nunca é float (ver REGRAS-GLOBAIS.md §4). */
  readonly amountInCents: number;
  readonly ownerName: string;
  readonly priority: Priority;
  readonly enteredStageAt: string;
  readonly stageAgeLabel: string;
  readonly nextAction: string;
  readonly conversationId?: Id;
  readonly history: readonly DealHistoryEntry[];
  readonly probability?: number; // 0 - 100
  readonly source?: DealSource;
  readonly team?: string;
  readonly tags?: readonly string[];
  readonly expectedCloseDate?: string;
  readonly tasks?: readonly DealTask[];
}

/** Um card é sinalizado como parado após este limite na mesma etapa. */
export const STALE_DEAL_DAYS = 5;

export const isDealStale = (deal: Deal, now: Date = new Date()): boolean => {
  const days = (now.getTime() - new Date(deal.enteredStageAt).getTime()) / 86_400_000;
  return days >= STALE_DEAL_DAYS;
};

export const sumDeals = (deals: readonly Deal[]): number =>
  deals.reduce((total, deal) => total + deal.amountInCents, 0);

export interface PipelineSummary {
  readonly totalDeals: number;
  readonly totalValueInCents: number;
  readonly inNegotiationCount: number;
  readonly inNegotiationValueInCents: number;
  readonly conversionRate: number; // 0 - 100
  readonly weightedForecastInCents: number;
}

export function calculatePipelineSummary(
  deals: readonly Deal[],
  stages: readonly PipelineStage[],
): PipelineSummary {
  const wonStageIds = new Set(stages.filter((s) => s.isWon).map((s) => s.id));
  const lostStageIds = new Set(stages.filter((s) => s.isLost).map((s) => s.id));

  let totalValueInCents = 0;
  let inNegotiationCount = 0;
  let inNegotiationValueInCents = 0;
  let weightedForecastInCents = 0;
  let wonCount = 0;
  let closedCount = 0;

  for (const deal of deals) {
    totalValueInCents += deal.amountInCents;
    const isWon = wonStageIds.has(deal.stageId);
    const isLost = lostStageIds.has(deal.stageId);

    if (isWon) {
      wonCount += 1;
      closedCount += 1;
    } else if (isLost) {
      closedCount += 1;
    } else {
      // Ativo no funil
      inNegotiationCount += 1;
      inNegotiationValueInCents += deal.amountInCents;
    }

    const prob = deal.probability ?? (isWon ? 100 : isLost ? 0 : 50);
    weightedForecastInCents += Math.round(deal.amountInCents * (prob / 100));
  }

  const conversionRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 25;

  return {
    totalDeals: deals.length,
    totalValueInCents,
    inNegotiationCount,
    inNegotiationValueInCents,
    conversionRate,
    weightedForecastInCents,
  };
}

export const STAGE_COLOR_PRESETS = [
  { name: 'Azul', value: '#3B82F6', textTone: 'text-blue-500', bgTone: 'bg-blue-500' },
  { name: 'Âmbar / Laranja', value: '#F59E0B', textTone: 'text-amber-500', bgTone: 'bg-amber-500' },
  { name: 'Roxo / Violeta', value: '#8B5CF6', textTone: 'text-purple-500', bgTone: 'bg-purple-500' },
  { name: 'Rosa / Magenta', value: '#EC4899', textTone: 'text-pink-500', bgTone: 'bg-pink-500' },
  { name: 'Verde / Esmeralda', value: '#10B981', textTone: 'text-emerald-500', bgTone: 'bg-emerald-500' },
  { name: 'Ciano', value: '#06B6D4', textTone: 'text-cyan-500', bgTone: 'bg-cyan-500' },
  { name: 'Índigo', value: '#6366F1', textTone: 'text-indigo-500', bgTone: 'bg-indigo-500' },
  { name: 'Ardósia / Cinza', value: '#64748B', textTone: 'text-slate-500', bgTone: 'bg-slate-500' },
] as const;

