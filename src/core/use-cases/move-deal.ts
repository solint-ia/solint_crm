import type { Deal } from '../domain/pipeline';
import { DomainError, fail, ok, type Id, type Result } from '../domain/shared';
import { can, type Session } from '../domain/user';
import type { PipelineRepository } from '../ports/pipeline-repository';

export interface MoveDealInput {
  readonly session: Session;
  readonly pipelineId: Id;
  readonly dealId: Id;
  readonly targetStageId: Id;
}

/** Move uma oportunidade entre etapas garantindo que a etapa pertence ao funil. */
export const createMoveDeal =
  (repository: PipelineRepository) =>
  async ({ session, pipelineId, dealId, targetStageId }: MoveDealInput): Promise<Result<Deal>> => {
    if (!can(session, 'kanban:escrever')) {
      return fail(new DomainError('Sem permissão para mover oportunidades.', 'FORBIDDEN'));
    }

    const pipelines = await repository.listPipelines(session.account.id);
    const pipeline = pipelines.find((item) => item.id === pipelineId);
    if (!pipeline) return fail(new DomainError('Funil não encontrado.', 'NOT_FOUND'));

    const stageExists = pipeline.stages.some((stage) => stage.id === targetStageId);
    if (!stageExists) {
      return fail(new DomainError('Etapa inválida para este funil.', 'INVALID_STAGE'));
    }

    const deal = await repository.moveDeal(session.account.id, dealId, targetStageId);
    return ok(deal);
  };
