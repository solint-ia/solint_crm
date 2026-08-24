import type { Id } from './shared';

export type AutomationTrigger =
  'conversa_criada' | 'mensagem_recebida' | 'conversa_pendente' | 'conversa_resolvida';

export const AUTOMATION_TRIGGER_LABELS: Readonly<Record<AutomationTrigger, string>> = {
  conversa_criada: 'Quando uma conversa é criada',
  mensagem_recebida: 'Quando chega uma mensagem',
  conversa_pendente: 'Quando a conversa fica pendente',
  conversa_resolvida: 'Quando a conversa é resolvida',
};

export type AutomationConditionField =
  'canal' | 'etiqueta' | 'fila' | 'prioridade' | 'horario' | 'palavra_chave';

export const AUTOMATION_FIELD_LABELS: Readonly<Record<AutomationConditionField, string>> = {
  canal: 'Canal',
  etiqueta: 'Etiqueta',
  fila: 'Fila',
  prioridade: 'Prioridade',
  horario: 'Horário',
  palavra_chave: 'Palavra-chave',
};

export type AutomationConditionOperator = 'igual' | 'diferente' | 'contem';

export const AUTOMATION_OPERATOR_LABELS: Readonly<Record<AutomationConditionOperator, string>> = {
  igual: 'é',
  diferente: 'não é',
  contem: 'contém',
};

export interface AutomationCondition {
  readonly field: AutomationConditionField;
  readonly operator: AutomationConditionOperator;
  readonly value: string;
}

export type AutomationActionType =
  | 'atribuir_equipe'
  | 'atribuir_agente'
  | 'definir_prioridade'
  | 'aplicar_etiqueta'
  | 'enviar_mensagem'
  | 'notificar'
  | 'resolver';

export const AUTOMATION_ACTION_LABELS: Readonly<Record<AutomationActionType, string>> = {
  atribuir_equipe: 'Atribuir à equipe',
  atribuir_agente: 'Atribuir ao agente',
  definir_prioridade: 'Definir prioridade',
  aplicar_etiqueta: 'Aplicar etiqueta',
  enviar_mensagem: 'Enviar mensagem',
  notificar: 'Notificar',
  resolver: 'Marcar como resolvida',
};

/**
 * Ações que escrevem um campo único da conversa: duas automações que gravam o
 * mesmo campo com valores diferentes não somam, uma sobrescreve a outra. É
 * exatamente isso que a deteção de conflito procura.
 */
const EXCLUSIVE_ACTIONS: ReadonlySet<AutomationActionType> = new Set([
  'atribuir_equipe',
  'atribuir_agente',
  'definir_prioridade',
  'resolver',
]);

export interface AutomationAction {
  readonly type: AutomationActionType;
  readonly value: string;
}

export interface Automation {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly conditions: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
  readonly enabled: boolean;
  readonly order: number;
}

/** Frase legível da regra, derivada dos blocos — nunca digitada à mão. */
export const describeAutomation = (automation: Automation): string => {
  const conditions =
    automation.conditions.length === 0
      ? 'sempre'
      : automation.conditions
          .map(
            (condition) =>
              `${AUTOMATION_FIELD_LABELS[condition.field].toLowerCase()} ${
                AUTOMATION_OPERATOR_LABELS[condition.operator]
              } ${condition.value}`,
          )
          .join(' e ');

  const actions = automation.actions
    .map((action) =>
      action.value
        ? `${AUTOMATION_ACTION_LABELS[action.type].toLowerCase()} ${action.value}`
        : AUTOMATION_ACTION_LABELS[action.type].toLowerCase(),
    )
    .join(', ');

  return `Se ${conditions}, então ${actions || 'nada'}.`;
};

export type ConflictSeverity = 'sobrescrita' | 'duplicidade';

export interface AutomationConflict {
  readonly firstId: Id;
  readonly secondId: Id;
  readonly severity: ConflictSeverity;
  readonly field: string;
  readonly explanation: string;
}

/**
 * Duas condições sobre o mesmo campo com `igual` e valores distintos nunca são
 * verdadeiras ao mesmo tempo: as automações se excluem e não podem colidir.
 */
const areMutuallyExclusive = (
  first: readonly AutomationCondition[],
  second: readonly AutomationCondition[],
): boolean =>
  first.some((a) =>
    second.some(
      (b) =>
        a.field === b.field &&
        a.operator === 'igual' &&
        b.operator === 'igual' &&
        a.value.toLowerCase() !== b.value.toLowerCase(),
    ),
  );

/**
 * Conflitos reais entre automações ativas, calculados — não escritos à mão.
 *
 * Um conflito exige três coisas ao mesmo tempo: mesmo gatilho, condições que
 * podem valer para a mesma conversa, e ações que disputam o mesmo destino.
 * Sem os três, as regras apenas convivem, e avisar seria ruído.
 */
export const detectAutomationConflicts = (
  automations: readonly Automation[],
): readonly AutomationConflict[] => {
  const active = automations.filter((automation) => automation.enabled);
  const conflicts: AutomationConflict[] = [];

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const first = active[i];
      const second = active[j];
      if (!first || !second) continue;
      if (first.trigger !== second.trigger) continue;
      if (areMutuallyExclusive(first.conditions, second.conditions)) continue;

      for (const action of first.actions) {
        const rival = second.actions.find((other) => other.type === action.type);
        if (!rival) continue;

        const label = AUTOMATION_ACTION_LABELS[action.type];
        const sameValue = rival.value.toLowerCase() === action.value.toLowerCase();

        if (EXCLUSIVE_ACTIONS.has(action.type) && !sameValue) {
          conflicts.push({
            firstId: first.id,
            secondId: second.id,
            severity: 'sobrescrita',
            field: label,
            explanation: `Ambas gravam “${label}” na mesma conversa com valores diferentes (“${action.value}” e “${rival.value}”). Vale a de maior ordem de execução — hoje, “${
              first.order <= second.order ? second.name : first.name
            }”.`,
          });
        } else if (action.type === 'enviar_mensagem') {
          conflicts.push({
            firstId: first.id,
            secondId: second.id,
            severity: 'duplicidade',
            field: label,
            explanation:
              'As duas enviam mensagem no mesmo gatilho: o cliente recebe duas mensagens seguidas.',
          });
        }
      }
    }
  }

  return conflicts;
};

/** Conflitos que envolvem uma automação específica — para marcar a linha na lista. */
export const conflictsOf = (
  conflicts: readonly AutomationConflict[],
  automationId: Id,
): readonly AutomationConflict[] =>
  conflicts.filter(
    (conflict) => conflict.firstId === automationId || conflict.secondId === automationId,
  );
