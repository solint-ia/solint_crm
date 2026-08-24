import type { Deal, Pipeline } from '../domain/pipeline';
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
      probability?: number;
    },
  ): Promise<Deal>;
  deleteDeal(accountId: Id, dealId: Id): Promise<void>;
}

