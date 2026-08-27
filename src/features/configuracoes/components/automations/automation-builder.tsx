'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, Plus, Trash2 } from 'lucide-react';
import type {
  Automation,
  AutomationAction,
  AutomationActionType,
  AutomationCondition,
  AutomationConditionField,
  AutomationConditionLogic,
  AutomationConditionOperator,
  AutomationTrigger,
} from '@/core/domain/automation';
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_CONDITION_LOGIC_LABELS,
  AUTOMATION_CONDITION_LOGICS,
  AUTOMATION_FIELD_LABELS,
  AUTOMATION_OPERATOR_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  describeAutomation,
  detectAutomationConflicts,
  logicOf,
} from '@/core/domain/automation';
import { Button } from '@/components/ui/button';
import { Field, Select, TextInput } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/cn';

/** Valores plausíveis para cada campo, vindos do workspace real. */
export interface BuilderVocabulary {
  readonly channels: readonly string[];
  readonly labels: readonly string[];
  readonly queues: readonly string[];
  readonly priorities: readonly string[];
  readonly teams: readonly string[];
  readonly agents: readonly string[];
  /** Nomes de etapas do funil, para a ação de mover o card. */
  readonly stages: readonly string[];
}

interface AutomationBuilderProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSave: (draft: {
    id?: string;
    name: string;
    trigger: AutomationTrigger;
    conditions: readonly AutomationCondition[];
    conditionLogic: AutomationConditionLogic;
    actions: readonly AutomationAction[];
    enabled: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Automação em edição. Ausente = criar nova. */
  readonly editing?: Automation;
  /** As demais automações, para avisar do conflito antes de salvar. */
  readonly siblings: readonly Automation[];
  readonly vocabulary: BuilderVocabulary;
}

const FIELD_OPTIONS = Object.keys(AUTOMATION_FIELD_LABELS) as AutomationConditionField[];
const OPERATOR_OPTIONS = Object.keys(AUTOMATION_OPERATOR_LABELS) as AutomationConditionOperator[];
const ACTION_OPTIONS = Object.keys(AUTOMATION_ACTION_LABELS) as AutomationActionType[];
const TRIGGER_OPTIONS = Object.keys(AUTOMATION_TRIGGER_LABELS) as AutomationTrigger[];

/** Ações sem complemento: "resolver" não pede valor nenhum. */
const VALUELESS_ACTIONS: ReadonlySet<AutomationActionType> = new Set(['resolver']);

const PLACEHOLDER: Readonly<Record<AutomationActionType, string>> = {
  atribuir_equipe: 'Comercial',
  atribuir_agente: 'Camila Reis',
  definir_prioridade: 'Alta',
  aplicar_etiqueta: 'VIP',
  enviar_mensagem: 'Nome do modelo ou resposta rápida',
  notificar: 'supervisor de plantão',
  resolver: '',
  mover_etapa_kanban: 'Proposta enviada',
};

const DRAFT_ID = 'draft-em-edicao';

export function AutomationBuilder({
  open,
  onClose,
  onSave,
  editing,
  siblings,
  vocabulary,
}: AutomationBuilderProps) {
  const [name, setName] = useState(editing?.name ?? '');
  const [trigger, setTrigger] = useState<AutomationTrigger>(editing?.trigger ?? 'conversa_criada');
  const [conditions, setConditions] = useState<readonly AutomationCondition[]>(
    editing?.conditions ?? [],
  );
  const [conditionLogic, setConditionLogic] = useState<AutomationConditionLogic>(
    editing ? logicOf(editing) : 'e',
  );
  const [actions, setActions] = useState<readonly AutomationAction[]>(
    editing?.actions ?? [{ type: 'atribuir_equipe', value: '' }],
  );
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const suggestionsFor = (field: AutomationConditionField): readonly string[] => {
    switch (field) {
      case 'canal':
        return vocabulary.channels;
      case 'etiqueta':
        return vocabulary.labels;
      case 'fila':
        return vocabulary.queues;
      case 'prioridade':
        return vocabulary.priorities;
      case 'horario':
        return ['dentro do expediente', 'fora do expediente'];
      case 'palavra_chave':
        return [];
    }
  };

  const actionSuggestions = (type: AutomationActionType): readonly string[] => {
    switch (type) {
      case 'atribuir_equipe':
        return vocabulary.teams;
      case 'atribuir_agente':
        return vocabulary.agents;
      case 'definir_prioridade':
        return vocabulary.priorities;
      case 'aplicar_etiqueta':
        return vocabulary.labels;
      case 'mover_etapa_kanban':
        return vocabulary.stages;
      default:
        return [];
    }
  };

  /**
   * A regra em construção é confrontada com as existentes a cada tecla.
   * Descobrir o conflito depois de salvar significa descobrir em produção,
   * quando uma conversa real já foi atribuída ao time errado.
   */
  const liveConflicts = useMemo(() => {
    const draft: Automation = {
      id: DRAFT_ID,
      accountId: editing?.accountId ?? '',
      name: name.trim() || 'Esta automação',
      trigger,
      conditions,
      conditionLogic,
      actions,
      enabled,
      order: editing?.order ?? Number.MAX_SAFE_INTEGER,
    };
    const others = siblings.filter((automation) => automation.id !== editing?.id);
    return detectAutomationConflicts([...others, draft]).filter(
      (conflict) => conflict.firstId === DRAFT_ID || conflict.secondId === DRAFT_ID,
    );
  }, [name, trigger, conditions, conditionLogic, actions, enabled, siblings, editing]);

  const sentence = useMemo(
    () =>
      describeAutomation({
        id: DRAFT_ID,
        accountId: '',
        name,
        trigger,
        conditions,
        conditionLogic,
        actions,
        enabled,
        order: 0,
      }),
    [name, trigger, conditions, conditionLogic, actions, enabled],
  );

  const handleSave = async () => {
    setError(undefined);
    setSaving(true);
    const result = await onSave({
      ...(editing ? { id: editing.id } : {}),
      name: name.trim(),
      trigger,
      conditions,
      conditionLogic,
      actions: actions.map((action) => ({
        ...action,
        value: VALUELESS_ACTIONS.has(action.type) ? '' : action.value.trim(),
      })),
      enabled,
    });
    setSaving(false);
    if (result.ok) onClose();
    else setError(result.error ?? 'Não foi possível salvar.');
  };

  const incomplete =
    name.trim().length < 3 ||
    actions.length === 0 ||
    actions.some(
      (action) => !VALUELESS_ACTIONS.has(action.type) && action.value.trim().length === 0,
    ) ||
    conditions.some((condition) => condition.value.trim().length === 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar automação' : 'Nova automação'}
      description="Gatilho, condições e ações. A frase abaixo é o que a regra faz."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={incomplete || saving}>
            {saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar automação'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Nome da regra" htmlFor="automation-name">
          <TextInput
            id="automation-name"
            value={name}
            maxLength={80}
            placeholder="Atribuir WhatsApp ao time Comercial"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        {/* ---------- Gatilho ---------- */}
        <BuilderStep index={1} title="Quando" hint="o evento que dispara a regra">
          <Select
            aria-label="Gatilho"
            value={trigger}
            onChange={(event) => setTrigger(event.target.value as AutomationTrigger)}
          >
            {TRIGGER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {AUTOMATION_TRIGGER_LABELS[option]}
              </option>
            ))}
          </Select>
        </BuilderStep>

        {/* ---------- Condições ---------- */}
        <BuilderStep
          index={2}
          title="E se"
          hint={
            conditions.length === 0
              ? 'sem condições, vale para todas'
              : conditionLogic === 'ou'
                ? 'basta uma delas valer'
                : 'todas precisam valer'
          }
        >
          <div className="flex flex-col gap-2">
            {/* O seletor só aparece a partir da segunda condição: com uma só,
                "todas" e "qualquer uma" descrevem a mesma coisa, e oferecer a
                escolha ali sugeriria uma diferença que não existe. */}
            {conditions.length > 1 ? (
              <Select
                aria-label="Como as condições se combinam"
                className="w-auto min-w-48 self-start"
                value={conditionLogic}
                onChange={(event) =>
                  setConditionLogic(event.target.value as AutomationConditionLogic)
                }
              >
                {AUTOMATION_CONDITION_LOGICS.map((logic) => (
                  <option key={logic} value={logic}>
                    {AUTOMATION_CONDITION_LOGIC_LABELS[logic]}
                  </option>
                ))}
              </Select>
            ) : null}

            {conditions.map((condition, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                {/* A conjunção aparece entre as linhas, onde ela é lida: a
                    regra se lê de cima para baixo, e o seletor sozinho no topo
                    não diz onde o "ou" entra. */}
                <span
                  aria-hidden
                  className={cn(
                    'w-6 shrink-0 text-right text-[11px] font-bold uppercase tracking-wide text-dim',
                    index === 0 && 'invisible',
                  )}
                >
                  {conditionLogic}
                </span>

                <Select
                  aria-label={`Campo da condição ${index + 1}`}
                  className="w-auto min-w-32 flex-1"
                  value={condition.field}
                  onChange={(event) =>
                    setConditions((current) =>
                      current.map((item, position) =>
                        position === index
                          ? {
                              ...item,
                              field: event.target.value as AutomationConditionField,
                              value: '',
                            }
                          : item,
                      ),
                    )
                  }
                >
                  {FIELD_OPTIONS.map((field) => (
                    <option key={field} value={field}>
                      {AUTOMATION_FIELD_LABELS[field]}
                    </option>
                  ))}
                </Select>

                <Select
                  aria-label={`Operador da condição ${index + 1}`}
                  className="w-auto min-w-24"
                  value={condition.operator}
                  onChange={(event) =>
                    setConditions((current) =>
                      current.map((item, position) =>
                        position === index
                          ? { ...item, operator: event.target.value as AutomationConditionOperator }
                          : item,
                      ),
                    )
                  }
                >
                  {OPERATOR_OPTIONS.map((operator) => (
                    <option key={operator} value={operator}>
                      {AUTOMATION_OPERATOR_LABELS[operator]}
                    </option>
                  ))}
                </Select>

                <TextInput
                  aria-label={`Valor da condição ${index + 1}`}
                  className="w-auto min-w-40 flex-[2]"
                  list={`suggestions-${condition.field}`}
                  value={condition.value}
                  onChange={(event) =>
                    setConditions((current) =>
                      current.map((item, position) =>
                        position === index ? { ...item, value: event.target.value } : item,
                      ),
                    )
                  }
                />

                <IconButton
                  label={`Remover condição ${index + 1}`}
                  onClick={() =>
                    setConditions((current) => current.filter((_, position) => position !== index))
                  }
                />
              </div>
            ))}

            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              icon={<Plus className="size-3.5" />}
              onClick={() =>
                setConditions((current) => [
                  ...current,
                  { field: 'canal', operator: 'igual', value: '' },
                ])
              }
            >
              Adicionar condição
            </Button>
          </div>
        </BuilderStep>

        {/* ---------- Ações ---------- */}
        <BuilderStep index={3} title="Então" hint="executadas na ordem em que aparecem">
          <div className="flex flex-col gap-2">
            {actions.map((action, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  aria-label={`Ação ${index + 1}`}
                  className="w-auto min-w-44 flex-1"
                  value={action.type}
                  onChange={(event) =>
                    setActions((current) =>
                      current.map((item, position) =>
                        position === index
                          ? { ...item, type: event.target.value as AutomationActionType, value: '' }
                          : item,
                      ),
                    )
                  }
                >
                  {ACTION_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {AUTOMATION_ACTION_LABELS[type]}
                    </option>
                  ))}
                </Select>

                {VALUELESS_ACTIONS.has(action.type) ? (
                  <span className="flex-[2] text-meta text-dim">sem complemento</span>
                ) : (
                  <TextInput
                    aria-label={`Valor da ação ${index + 1}`}
                    className="w-auto min-w-40 flex-[2]"
                    list={`action-suggestions-${action.type}`}
                    placeholder={PLACEHOLDER[action.type]}
                    value={action.value}
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                  />
                )}

                <IconButton
                  label={`Remover ação ${index + 1}`}
                  disabled={actions.length === 1}
                  onClick={() =>
                    setActions((current) => current.filter((_, position) => position !== index))
                  }
                />
              </div>
            ))}

            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              icon={<Plus className="size-3.5" />}
              onClick={() =>
                setActions((current) => [...current, { type: 'aplicar_etiqueta', value: '' }])
              }
            >
              Adicionar ação
            </Button>
          </div>
        </BuilderStep>

        {/* Listas de sugestão: preenchem sem restringir — a regra aceita texto livre. */}
        {FIELD_OPTIONS.map((field) => (
          <datalist key={field} id={`suggestions-${field}`}>
            {suggestionsFor(field).map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        ))}
        {ACTION_OPTIONS.map((type) => (
          <datalist key={type} id={`action-suggestions-${type}`}>
            {actionSuggestions(type).map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        ))}

        <div className="rounded-control border border-line bg-surface-2 px-3.5 py-3">
          <p className="text-micro font-semibold tracking-wide text-dim uppercase">
            A regra, em uma frase
          </p>
          <p className="mt-1 text-body leading-relaxed text-ink">{sentence}</p>
        </div>

        {liveConflicts.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-control border border-note-line bg-note p-3.5">
            <p className="flex items-center gap-2 text-body font-bold text-note-text">
              <AlertTriangle className="size-3.5 shrink-0 text-amber-text" />
              {liveConflicts.length === 1
                ? 'Esta regra conflita com outra ativa'
                : `Esta regra conflita com ${liveConflicts.length} regras ativas`}
            </p>
            <ul className="flex flex-col gap-1.5">
              {liveConflicts.map((conflict, index) => (
                <li key={index} className="text-meta leading-relaxed text-note-text">
                  {conflict.explanation}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <label className="flex items-center gap-3 border-t border-line pt-4">
          <Toggle checked={enabled} onChange={setEnabled} label="Ativar a automação ao salvar" />
          <span className="text-body text-muted">
            {enabled ? 'Ativa assim que salvar' : 'Salvar desativada (rascunho)'}
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-meta font-medium text-red-text">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Passo numerado do construtor. A numeração aqui é real: a ordem é o modelo. */
function BuilderStep({
  index,
  title,
  hint,
  children,
}: {
  readonly index: number;
  readonly title: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="relative">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-mono text-micro font-bold text-dim tabular-nums">
          {String(index).padStart(2, '0')}
        </span>
        <h3 className="font-display text-ui font-bold tracking-tight text-ink">{title}</h3>
        <span className="text-meta text-dim">{hint}</span>
      </div>
      {children}
      {index < 3 ? (
        <ArrowDown aria-hidden="true" className="mt-2 ml-1 size-3 text-line" />
      ) : null}
    </section>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-control text-dim transition-colors',
        'hover:bg-red-soft hover:text-red-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-dim',
      )}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
