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
      source?: string;
      nextAction?: string;
    },
  ): Promise<Deal>;
  deleteDeal(accountId: Id, dealId: Id): Promise<void>;
  /**
   * Apaga todos os cards de um contato. Devolve quantos saíram.
   *
   * Usado quando o contato perde a última etiqueta ligada a uma etapa: sem
   * etiqueta de etapa ele não pertence a nenhuma coluna, e um card fora de
   * coluna não existe.
   */
  deleteDealsOfContact(accountId: Id, contactId: Id): Promise<number>;

  /**
   * Checklist do card.
   *
   * As três devolvem o card inteiro, já com as tarefas recarregadas: a tela
   * precisa do estado final e uma segunda ida ao banco para buscá-lo abriria
   * espaço para mostrar a lista desatualizada.
   */
  addDealTask(accountId: Id, dealId: Id, title: string): Promise<Deal>;
  toggleDealTask(accountId: Id, dealId: Id, taskId: Id): Promise<Deal>;
  deleteDealTask(accountId: Id, dealId: Id, taskId: Id): Promise<Deal>;
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
      conversionWeight: number;
      /** `null` desfaz o vínculo; ausente mantém o que já estava gravado. */
      labelId?: string | null;
    }[],
  ): Promise<readonly PipelineStage[]>;
}


