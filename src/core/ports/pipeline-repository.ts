import type { Deal, Pipeline, PipelineStage } from '../domain/pipeline';
import type { Id } from '../domain/shared';

export interface PipelineRepository {
  listPipelines(accountId: Id): Promise<readonly Pipeline[]>;
  listDeals(accountId: Id, pipelineId: Id): Promise<readonly Deal[]>;
  moveDeal(accountId: Id, dealId: Id, targetStageId: Id): Promise<Deal>;
  createDeal(
    accountId: Id,
    draft: {
      pipelineId: Id;
      stageId: Id;
      title: string;
      value: number;
      contactName?: string;
      companyName?: string;
      ownerName?: string;
      priority?: string;
      probability?: number;
      source?: string;
      nextAction?: string;
    },
  ): Promise<Deal>;
  updateDeal(
    accountId: Id,
    dealId: Id,
    patch: {
      title?: string;
      value?: number;
      stageId?: string;
      contactName?: string;
      companyName?: string;
      ownerName?: string;
      priority?: string;
      probability?: number;
      source?: string;
      nextAction?: string;
    },
  ): Promise<Deal>;
  deleteDeal(accountId: Id, dealId: Id): Promise<void>;
  updateStages(
    accountId: Id,
    pipelineId: Id,
    stages: readonly {
      id?: string;
      name: string;
      order: number;
      color: string;
      isWon: boolean;
      isLost: boolean;
      defaultProbability?: number;
    }[],
  ): Promise<readonly PipelineStage[]>;
}


