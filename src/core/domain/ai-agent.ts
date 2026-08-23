import type { Id } from './shared';

export type TransferRuleType = 'palavra_chave' | 'intencao' | 'horario' | 'solicitacao_explicita';

export interface TransferRule {
  readonly id: Id;
  readonly type: TransferRuleType;
  readonly condition: string;
  readonly enabled: boolean;
}

export interface KnowledgeDocument {
  readonly id: Id;
  readonly name: string;
  readonly updatedLabel: string;
  readonly sizeLabel?: string;
}

export type HandoffResult = 'concluido_ia' | 'transferido_humano' | 'abandonado';

export interface AiAgentLog {
  readonly id: Id;
  readonly contactName: string;
  readonly date: string;
  readonly result: HandoffResult;
}

/**
 * Blocos do fluxo do agente.
 *
 * A versão anterior era uma lista fixa de quatro rótulos: bonita e inerte. Um
 * fluxo real precisa de ramificação (a pergunta que leva a caminhos diferentes)
 * e de um fim explícito, senão não dá para saber se a conversa termina. O
 * `targetId` de cada saída é o que transforma a lista em grafo.
 */
export const FLOW_BLOCK_TYPES = [
  'inicio',
  'mensagem',
  'pergunta',
  'consultar_base',
  'condicao',
  'transferir',
  'encerrar',
] as const;
export type FlowBlockType = (typeof FLOW_BLOCK_TYPES)[number];

export const FLOW_BLOCK_LABELS: Readonly<Record<FlowBlockType, string>> = {
  inicio: 'Início',
  mensagem: 'Enviar mensagem',
  pergunta: 'Perguntar',
  consultar_base: 'Consultar base',
  condicao: 'Condição',
  transferir: 'Transferir para humano',
  encerrar: 'Encerrar',
};

/** Blocos que encerram um caminho: depois deles não há para onde ir. */
const TERMINAL_BLOCKS: ReadonlySet<FlowBlockType> = new Set(['transferir', 'encerrar']);

export const isTerminalBlock = (type: FlowBlockType): boolean => TERMINAL_BLOCKS.has(type);

export interface FlowBranch {
  readonly label: string;
  /** Bloco de destino. Vazio significa saída não ligada — o validador acusa. */
  readonly targetId?: Id;
}

export interface AgentFlowBlock {
  readonly id: Id;
  readonly type: FlowBlockType;
  readonly title: string;
  readonly detail?: string;
  /** Saídas do bloco. Um bloco linear tem uma; uma condição tem duas ou mais. */
  readonly branches: readonly FlowBranch[];
}

export type FlowProblemKind = 'sem_inicio' | 'saida_solta' | 'inalcancavel' | 'sem_saida';

export interface FlowProblem {
  readonly kind: FlowProblemKind;
  readonly blockId?: Id;
  readonly message: string;
}

/**
 * Problemas estruturais do fluxo. Um fluxo que parece certo na tela e trava em
 * produção é pior que um fluxo obviamente incompleto — por isso a validação
 * roda no domínio e aparece junto do desenho.
 */
export const validateAgentFlow = (blocks: readonly AgentFlowBlock[]): readonly FlowProblem[] => {
  if (blocks.length === 0) return [];

  const problems: FlowProblem[] = [];
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const start = blocks.find((block) => block.type === 'inicio');

  if (!start) {
    problems.push({ kind: 'sem_inicio', message: 'O fluxo não tem bloco de início.' });
  }

  for (const block of blocks) {
    if (isTerminalBlock(block.type)) continue;

    if (block.branches.length === 0) {
      problems.push({
        kind: 'sem_saida',
        blockId: block.id,
        message: `“${block.title}” não leva a lugar nenhum: a conversa para aqui sem encerrar.`,
      });
      continue;
    }

    for (const branch of block.branches) {
      if (!branch.targetId || !byId.has(branch.targetId)) {
        problems.push({
          kind: 'saida_solta',
          blockId: block.id,
          message: `A saída “${branch.label}” de “${block.title}” não está ligada a nenhum bloco.`,
        });
      }
    }
  }

  if (start) {
    const reached = new Set<Id>([start.id]);
    const queue: Id[] = [start.id];
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) break;
      const current = byId.get(currentId);
      if (!current) continue;
      for (const branch of current.branches) {
        if (branch.targetId && !reached.has(branch.targetId) && byId.has(branch.targetId)) {
          reached.add(branch.targetId);
          queue.push(branch.targetId);
        }
      }
    }

    for (const block of blocks) {
      if (!reached.has(block.id)) {
        problems.push({
          kind: 'inalcancavel',
          blockId: block.id,
          message: `“${block.title}” nunca é alcançado a partir do início.`,
        });
      }
    }
  }

  return problems;
};

export interface AiAgent {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly scope: string;
  readonly active: boolean;
  readonly persona: string;
  readonly systemPrompt: string;
  readonly model: string;
  readonly handledCount: number;
  readonly transferRate: string;
  readonly knowledgeBase: readonly KnowledgeDocument[];
  readonly transferRules: readonly TransferRule[];
  readonly flow: readonly AgentFlowBlock[];
  readonly logs: readonly AiAgentLog[];
}

export const TRANSFER_RULE_LABELS: Readonly<Record<TransferRuleType, string>> = {
  palavra_chave: 'Palavra-chave',
  intencao: 'Intenção',
  horario: 'Horário',
  solicitacao_explicita: 'Solicitação explícita',
};

export const HANDOFF_RESULT_LABELS: Readonly<Record<HandoffResult, string>> = {
  concluido_ia: 'Concluído pela IA',
  transferido_humano: 'Transferido p/ humano',
  abandonado: 'Abandonado pelo cliente',
};
