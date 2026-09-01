import type { Id } from './shared';

export const AUTOMATION_TRIGGERS = [
  'conversa_criada',
  'mensagem_recebida',
  'conversa_pendente',
  'conversa_resolvida',
  'etiqueta_aplicada',
] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_TRIGGER_LABELS: Readonly<Record<AutomationTrigger, string>> = {
  conversa_criada: 'Quando uma conversa é criada',
  mensagem_recebida: 'Quando chega uma mensagem',
  conversa_pendente: 'Quando a conversa fica pendente',
  conversa_resolvida: 'Quando a conversa é resolvida',
  etiqueta_aplicada: 'Quando uma etiqueta é aplicada',
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

/**
 * Como as condições se combinam.
 *
 * Duas opções, e só duas. Um construtor de regras cresce por aqui — grupos
 * aninhados, "nenhuma das anteriores", parênteses —, e cada degrau desses
 * multiplica o que a tela precisa desenhar e o que o motor precisa avaliar,
 * para atender um caso que quase nunca chega. `e` e `ou` cobrem o que se pede
 * numa regra de atendimento; o que não couber nas duas cabe em duas regras.
 *
 * O padrão é `e` porque foi assim que toda automação existente se comportou
 * até agora: a lista de condições sempre foi avaliada com `every`. Uma regra
 * gravada antes deste campo continua valendo exatamente o que valia.
 */
export const AUTOMATION_CONDITION_LOGICS = ['e', 'ou'] as const;

export type AutomationConditionLogic = (typeof AUTOMATION_CONDITION_LOGICS)[number];

export const AUTOMATION_CONDITION_LOGIC_LABELS: Readonly<
  Record<AutomationConditionLogic, string>
> = {
  e: 'Todas as condições',
  ou: 'Qualquer condição',
};

/** Como a frase da regra liga uma condição à seguinte. */
export const AUTOMATION_CONDITION_LOGIC_JOINERS: Readonly<
  Record<AutomationConditionLogic, string>
> = {
  e: ' e ',
  ou: ' ou ',
};

export const AUTOMATION_ACTION_TYPES = [
  'atribuir_equipe',
  'atribuir_agente',
  'definir_prioridade',
  'aplicar_etiqueta',
  'enviar_mensagem',
  'notificar',
  'resolver',
  'mover_etapa_kanban',
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const AUTOMATION_ACTION_LABELS: Readonly<Record<AutomationActionType, string>> = {
  atribuir_equipe: 'Atribuir à equipe',
  atribuir_agente: 'Atribuir ao agente',
  definir_prioridade: 'Definir prioridade',
  aplicar_etiqueta: 'Aplicar etiqueta',
  enviar_mensagem: 'Enviar mensagem',
  notificar: 'Notificar',
  resolver: 'Marcar como resolvida',
  mover_etapa_kanban: 'Mover para a etapa do funil',
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
  // Um card mora numa etapa só: duas regras mandando para etapas diferentes é
  // exatamente a sobrescrita que o detector procura.
  'mover_etapa_kanban',
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
  /** Ausente em regras gravadas antes do campo — vale `e`, o comportamento antigo. */
  readonly conditionLogic?: AutomationConditionLogic;
  readonly actions: readonly AutomationAction[];
  readonly enabled: boolean;
  readonly order: number;
}

/**
 * A combinação da regra, com o padrão aplicado num lugar só.
 *
 * Espalhar `?? 'e'` por descrição, avaliação e formulário é como as três
 * acabam divergindo — basta uma esquecer o padrão para a mesma regra ser
 * descrita de um jeito e avaliada de outro.
 */
export const logicOf = (automation: Pick<Automation, 'conditionLogic'>): AutomationConditionLogic =>
  automation.conditionLogic ?? 'e';

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
          .join(AUTOMATION_CONDITION_LOGIC_JOINERS[logicOf(automation)]);

  const actions = automation.actions
    .map((action) =>
      action.value
        ? `${AUTOMATION_ACTION_LABELS[action.type].toLowerCase()} ${action.value}`
        : AUTOMATION_ACTION_LABELS[action.type].toLowerCase(),
    )
    .join(', ');

  return `Se ${conditions}, então ${actions || 'nada'}.`;
};

/**
 * O que o motor sabe sobre o momento em que a automação disparou.
 *
 * Deliberadamente raso — rótulos e textos, não entidades. O casamento de
 * condição é comparação de string (é o que o construtor grava: "Suporte",
 * "VIP", "alta"), e receber a conversa inteira aqui amarraria o domínio da
 * automação ao de conversas sem necessidade.
 */
export interface AutomationContext {
  readonly canal: string;
  readonly fila: string;
  readonly prioridade: string;
  readonly etiquetas: readonly string[];
  /** Texto da mensagem que disparou, quando houve uma. */
  readonly texto?: string;
  /** Está dentro do horário de atendimento da caixa? */
  readonly dentroDoHorario?: boolean;
}

const normalizar = (valor: string): string => valor.trim().toLowerCase();

/**
 * O valor observado para um campo de condição.
 *
 * `etiqueta` devolve várias: uma conversa tem um conjunto delas, e "etiqueta é
 * VIP" precisa ser verdade se **alguma** for VIP.
 */
const observado = (
  field: AutomationConditionField,
  context: AutomationContext,
): readonly string[] => {
  switch (field) {
    case 'canal':
      return [context.canal];
    case 'fila':
      return [context.fila];
    case 'prioridade':
      return [context.prioridade];
    case 'etiqueta':
      return context.etiquetas;
    case 'palavra_chave':
      return context.texto ? [context.texto] : [];
    case 'horario':
      // Sem informação de horário a condição não é afirmável; devolver vazio
      // faz `igual` falhar, que é o lado seguro: melhor não disparar do que
      // disparar por engano fora do expediente.
      return context.dentroDoHorario === undefined
        ? []
        : [context.dentroDoHorario ? 'dentro' : 'fora'];
    default:
      return [];
  }
};

const satisfaz = (condition: AutomationCondition, context: AutomationContext): boolean => {
  const valores = observado(condition.field, context).map(normalizar);
  const alvo = normalizar(condition.value);

  switch (condition.operator) {
    case 'igual':
      return valores.some((valor) => valor === alvo);
    case 'contem':
      return valores.some((valor) => valor.includes(alvo));
    case 'diferente':
      // "Nenhum dos observados é o alvo" — e não "algum é diferente", que seria
      // verdade para qualquer conversa com duas etiquetas.
      return !valores.some((valor) => valor === alvo);
    default:
      return false;
  }
};

/**
 * A automação vale para este momento?
 *
 * Com `e`, todas as condições precisam valer; com `ou`, basta uma. Sem
 * condições, vale sempre — nos dois casos, e é por isso que a lista vazia é
 * testada antes: `some` sobre uma lista vazia é falso, e uma regra "qualquer
 * condição" sem nenhuma condição deixaria de disparar ao trocar de `e` para
 * `ou`, sem que nada na tela explicasse por quê.
 */
export const automationMatches = (
  automation: Automation,
  context: AutomationContext,
): boolean => {
  if (!automation.enabled) return false;
  if (automation.conditions.length === 0) return true;

  return logicOf(automation) === 'ou'
    ? automation.conditions.some((condition) => satisfaz(condition, context))
    : automation.conditions.every((condition) => satisfaz(condition, context));
};

/** Regras que devem rodar para um gatilho, já na ordem de execução. */
export const automationsFor = (
  automations: readonly Automation[],
  trigger: AutomationTrigger,
  context: AutomationContext,
): readonly Automation[] =>
  automations
    .filter((automation) => automation.trigger === trigger && automationMatches(automation, context))
    .toSorted((a, b) => a.order - b.order);

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
            explanation: `Ambas gravam “${label}” na mesma conversa com valores diferentes (“${action.value}” e “${rival.value}”). Vale a de maior ordem de execução: hoje, “${
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
