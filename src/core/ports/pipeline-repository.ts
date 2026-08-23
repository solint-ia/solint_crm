import type { Deal, Pipeline } from '../domain/pipeline';
import type { Id } from '../domain/shared';

export interface PipelineRepository {
  listPipelines(accountId: Id): Promise<readonly Pipeline[]>;
  listDeals(accountId: Id, pipelineId: Id): Promise<readonly Deal[]>;
  moveDeal(accountId: Id, dealId: Id, targetStageId: Id): Promise<Deal>;
}
