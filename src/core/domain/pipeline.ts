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

/** Oportunidade (card do funil). */
export interface Deal {
  readonly id: Id;
  readonly accountId: Id;
  readonly pipelineId: Id;
  readonly stageId: Id;
  readonly contactId?: Id;
  readonly contactName: string;
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
}

/** Um card é sinalizado como parado após este limite na mesma etapa. */
export const STALE_DEAL_DAYS = 5;

export const isDealStale = (deal: Deal, now: Date = new Date()): boolean => {
  const days = (now.getTime() - new Date(deal.enteredStageAt).getTime()) / 86_400_000;
  return days >= STALE_DEAL_DAYS;
};

export const sumDeals = (deals: readonly Deal[]): number =>
  deals.reduce((total, deal) => total + deal.amountInCents, 0);
