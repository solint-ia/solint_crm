import type { Deal, Pipeline, PipelineStage } from '../domain/pipeline';
import type { Id } from '../domain/shared';

export interface PipelineRepository {
  listPipelines(accountId: Id): Promise<readonly Pipeline[]>;
  createPipeline(accountId: Id, name: string): Promise<Pipeline>;
  /** Liga ou desliga a exibição de valores (R$) no funil. */
  setShowAmounts(accountId: Id, pipelineId: Id, showAmounts: boolean): Promise<Pipeline>;
  /**
   * Exceção de exibição do valor de um card específico.
   *
   * `null` apaga a exceção e volta a seguir o funil — é o "herdar do funil",
   * não um terceiro estado gravado.
   */
  setDealShowAmount(accountId: Id, dealId: Id, showAmount: boolean | null): Promise<Deal>;
  /** Exclui um funil personalizado e devolve quantas oportunidades saíram com ele. */
  deletePipeline(accountId: Id, pipelineId: Id): Promise<number>;
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
      showAmount?: boolean | null;
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
      showAmount?: boolean | null;
    },
  ): Promise<Deal>;
  deleteDeal(accountId: Id, dealId: Id): Promise<void>;
  /**
   * Apaga todos os cards de um contato. Devolve quantos saíram.
   *
   * Usado quando o contato fica sem etiqueta, ou perde a última ligada a uma
   * etapa: sem ela ele não pertence a nenhuma coluna, e um card fora de coluna
   * não existe.
   */
  deleteDealsOfContact(accountId: Id, contactId: Id): Promise<number>;
  /**
   * Apaga os cards ligados a uma conversa, em qualquer funil. Devolve quantos saíram.
   *
   * O par do anterior para a etiqueta da conversa: é ela que as automações
   * leem para colocar a conversa no funil, e tirá-la tira a conversa de lá.
   */
  deleteDealsOfConversation(accountId: Id, conversationId: Id): Promise<number>;

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
