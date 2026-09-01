import type { Priority } from './conversation';
import type { Id, IsoDateTime } from './shared';
import type { InboxAccess } from './user';

export interface PipelineStage {
  readonly id: Id;
  readonly pipelineId: Id;
  readonly name: string;
  readonly order: number;
  readonly color: string;
  readonly isWon: boolean;
  readonly isLost: boolean;
  /** Percentual que um card nesta etapa representa no indicador ponderado. */
  readonly conversionWeight: number;
  /**
   * Etiqueta que espelha esta etapa no cadastro do contato.
   *
   * É o que liga o funil às etiquetas: mover o card para cá aplica esta
   * etiqueta ao contato, e o contato que fica sem nenhuma etiqueta de etapa
   * sai do quadro. Ausente quando a etapa não espelha etiqueta nenhuma — aí o
   * card só se move na mão, como sempre foi.
   */
  readonly labelId?: Id;
}

/**
 * Etiquetas que alguma etapa espelha, em qualquer funil da conta.
 *
 * É o conjunto que decide se um contato pertence ao quadro: perder a última
 * etiqueta **deste** conjunto é o que tira o card do funil. Uma etiqueta que
 * nenhuma etapa espelha ("VIP", "Reclamação") não conta — ela descreve o
 * contato, não o lugar dele no funil.
 */
/**
 * As etiquetas do contato depois de mover o card para uma etapa.
 *
 * Duas coisas acontecem: as etiquetas das **outras** etapas deste funil saem, e
 * a da etapa de destino entra. Tirar as outras é o que mantém o par
 * contato ↔ etapa consistente — sem isso o contato acumularia "Novo Lead",
 * "Qualificação" e "Proposta" ao mesmo tempo, e a próxima leitura não teria
 * como dizer em qual etapa ele está.
 *
 * O recorte é o funil, não a conta: um contato pode estar num segundo funil ao
 * mesmo tempo, e a etiqueta de lá não tem nada a ver com este movimento.
 * Etiquetas que nenhuma etapa espelha ("VIP", "Reclamação") passam intactas —
 * elas descrevem o contato, não o lugar dele no funil.
 *
 * Função pura de propósito: é a única regra aqui que vale a pena poder
 * verificar sem banco.
 */
export const contactLabelsAfterMove = (
  pipeline: Pipeline,
  targetStageId: Id,
  currentLabelIds: readonly Id[],
): readonly Id[] => {
  const doFunil = new Set(
    pipeline.stages.map((stage) => stage.labelId).filter((id): id is Id => Boolean(id)),
  );
  const destino = pipeline.stages.find((stage) => stage.id === targetStageId)?.labelId;

  const preservadas = currentLabelIds.filter((id) => !doFunil.has(id));
  return destino ? [...preservadas, destino] : preservadas;
};

export const stageLabelIds = (pipelines: readonly Pipeline[]): ReadonlySet<Id> =>
  new Set(
    pipelines.flatMap((pipeline) =>
      pipeline.stages.map((stage) => stage.labelId).filter((id): id is Id => Boolean(id)),
    ),
  );

export interface Pipeline {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly stages: readonly PipelineStage[];
  /**
   * A caixa de entrada a que este funil pertence.
   *
   * Ausente = funil avulso, que atravessa canais. Um número de WhatsApp por
   * funil é o padrão desde que a conta passou a poder ter mais de uma conexão:
   * quem atende dois números costuma vender duas coisas diferentes, e misturar
   * os dois num quadro só torna o total do funil um número sem dono.
   */
  readonly inboxId?: Id;
  /** Nome da conexão, para o seletor dizer de qual caixa é este funil. */
  readonly inboxName?: string;
}

/**
 * Os funis que esta pessoa alcança.
 *
 * Um funil avulso é sempre visível — ele não pertence a canal nenhum, então
 * não há caixa a respeitar. Um funil de caixa segue exatamente a mesma regra
 * das conversas: quem não alcança a caixa não alcança o funil dela. Sem isto,
 * um colaborador restrito a uma equipe veria no Kanban os negócios de um canal
 * cujas conversas ele não pode abrir.
 */
export const visiblePipelines = (
  pipelines: readonly Pipeline[],
  inboxAccess: InboxAccess,
): readonly Pipeline[] =>
  inboxAccess === 'todas'
    ? pipelines
    : pipelines.filter((p) => !p.inboxId || inboxAccess.includes(p.inboxId));

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
  'whatsapp' | 'instagram' | 'site' | 'indicacao' | 'google' | 'inbound' | 'outbound';

export const DEAL_SOURCES: readonly { readonly id: DealSource; readonly label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'site', label: 'Website / Inbound' },
  { id: 'indicacao', label: 'Indicação' },
  { id: 'google', label: 'Google Ads' },
  { id: 'inbound', label: 'Formulário' },
  { id: 'outbound', label: 'Prospecção Ativa' },
];

/**
 * Oportunidade (card do funil).
 *
 * Todo campo daqui existe como coluna e é preenchido por algum caminho de
 * escrita. Já não foi assim: `title`, `source`, `team`, `tags` e
 * `expectedCloseDate` conviveram aqui como opcionais que **nenhuma** consulta
 * jamais preenchia, porque não havia coluna nenhuma por trás. O TypeScript não
 * reclamava (são opcionais), e o efeito aparecia longe: a busca do quadro
 * procurava por `title` e nunca achava, e os filtros de Origem e Equipe
 * ofereciam listas vazias que descartavam todos os cards ao serem usadas.
 *
 * `title` e `source` ganharam coluna. `team`, `tags` e `expectedCloseDate`
 * saíram: nada no sistema sabe derivar a equipe de um negócio, e um campo de
 * texto livre para isso só produziria dado sujo. Se a equipe voltar, virá por
 * relação com `Team`, não por texto.
 */
export interface Deal {
  readonly id: Id;
  readonly accountId: Id;
  readonly pipelineId: Id;
  readonly stageId: Id;
  readonly contactId?: Id;
  readonly contactName: string;
  /** Nome do negócio no quadro. Ausente quando o card é só o contato. */
  readonly title?: string;
  readonly company?: string;
  /** Valor em centavos — dinheiro nunca é float (ver REGRAS-GLOBAIS.md §4). */
  readonly amountInCents: number;
  readonly ownerName: string;
  readonly priority: Priority;
  /** Quando o card nasceu. É por aqui que o filtro de período recorta. */
  readonly createdAt: IsoDateTime;
  readonly enteredStageAt: string;
  readonly stageAgeLabel: string;
  readonly nextAction: string;
  readonly conversationId?: Id;
  readonly history: readonly DealHistoryEntry[];
  readonly source?: DealSource;
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
}

export const DEFAULT_WON_WEIGHT = 100;
export const DEFAULT_NEGOTIATION_WEIGHT = 50;

export function calculatePipelineSummary(
  deals: readonly Deal[],
  stages: readonly PipelineStage[],
): PipelineSummary {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));

  let totalValueInCents = 0;
  let inNegotiationCount = 0;
  let inNegotiationValueInCents = 0;
  let conversionWeightTotal = 0;

  for (const deal of deals) {
    totalValueInCents += deal.amountInCents;
    const stage = stageById.get(deal.stageId);
    const isWon = stage?.isWon === true;
    const isLost = stage?.isLost === true;
    conversionWeightTotal += isLost ? 0 : Math.min(100, Math.max(0, stage?.conversionWeight ?? 0));

    if (!isWon && !isLost) {
      // Ativo no funil
      inNegotiationCount += 1;
      inNegotiationValueInCents += deal.amountInCents;
    }
  }

  const conversionRate = deals.length > 0 ? Math.round(conversionWeightTotal / deals.length) : 0;

  return {
    totalDeals: deals.length,
    totalValueInCents,
    inNegotiationCount,
    inNegotiationValueInCents,
    conversionRate,
  };
}

export const STAGE_COLOR_PRESETS = [
  { name: 'Azul', value: '#3B82F6', textTone: 'text-blue-500', bgTone: 'bg-blue-500' },
  { name: 'Âmbar / Laranja', value: '#F59E0B', textTone: 'text-amber-500', bgTone: 'bg-amber-500' },
  {
    name: 'Roxo / Violeta',
    value: '#8B5CF6',
    textTone: 'text-purple-500',
    bgTone: 'bg-purple-500',
  },
  { name: 'Rosa / Magenta', value: '#EC4899', textTone: 'text-pink-500', bgTone: 'bg-pink-500' },
  {
    name: 'Verde / Esmeralda',
    value: '#10B981',
    textTone: 'text-emerald-500',
    bgTone: 'bg-emerald-500',
  },
  { name: 'Ciano', value: '#06B6D4', textTone: 'text-cyan-500', bgTone: 'bg-cyan-500' },
  { name: 'Índigo', value: '#6366F1', textTone: 'text-indigo-500', bgTone: 'bg-indigo-500' },
  { name: 'Ardósia / Cinza', value: '#64748B', textTone: 'text-slate-500', bgTone: 'bg-slate-500' },
] as const;
