'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import type { Automation } from '@/core/domain/automation';
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  conflictsOf,
  describeAutomation,
  detectAutomationConflicts,
} from '@/core/domain/automation';
import type { AssignmentMethod, Macro } from '@/core/domain/settings';
import { ASSIGNMENT_METHOD_LABELS } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionTitle } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  deleteAutomationAction,
  moveAutomationAction,
  saveAutomationAction,
  setAssignmentMethodAction,
  toggleAutomationAction,
} from '@/app/(workspace)/configuracoes/actions';
import {
  AutomationBuilder,
  type BuilderVocabulary,
} from '../automations/automation-builder';

interface AutomationsSectionProps {
  readonly initialAutomations: readonly Automation[];
  readonly macros: readonly Macro[];
  readonly initialAssignmentMethod: AssignmentMethod;
  readonly vocabulary: BuilderVocabulary;
}

type AutoSubTab = 'regras' | 'atribuicao' | 'macros';

const SUB_TABS = [
  { id: 'regras', label: 'Regras' },
  { id: 'atribuicao', label: 'Atribuição' },
  { id: 'macros', label: 'Macros' },
] as const;

export function AutomationsSection({
  initialAutomations,
  macros,
  initialAssignmentMethod,
  vocabulary,
}: AutomationsSectionProps) {
  const [subTab, setSubTab] = useState<AutoSubTab>('regras');
  const [automations, setAutomations] = useState<readonly Automation[]>(initialAutomations);
  const [assignmentMethod, setAssignmentMethod] =
    useState<AssignmentMethod>(initialAssignmentMethod);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | undefined>();
  const { show } = useToast();

  const ordered = useMemo(
    () => [...automations].sort((a, b) => a.order - b.order),
    [automations],
  );

  /**
   * O aviso de conflito é calculado, não escrito.
   * A versão anterior trazia um texto fixo citando duas regras pelo nome: ele
   * continuaria ali depois de você desativar uma das duas, e some quando o
   * conflito é real. Um alerta que não acompanha o estado ensina a ignorá-lo.
   */
  const conflicts = useMemo(() => detectAutomationConflicts(ordered), [ordered]);

  const refresh = async (mutate: () => Promise<{ ok: boolean; error?: string }>) => {
    const result = await mutate();
    if (!result.ok) {
      show({ tone: 'erro', title: 'Não foi possível salvar', description: result.error });
    }
    return result.ok;
  };

  const handleToggleAutomation = async (id: string, current: boolean) => {
    const next = !current;
    setAutomations((prev) =>
      prev.map((item) => (item.id === id ? { ...item, enabled: next } : item)),
    );
    const ok = await refresh(() => toggleAutomationAction({ automationId: id, enabled: next }));
    if (!ok) {
      setAutomations((prev) =>
        prev.map((item) => (item.id === id ? { ...item, enabled: current } : item)),
      );
    }
  };

  const handleSetAssignmentMethod = async (method: AssignmentMethod) => {
    const previous = assignmentMethod;
    setAssignmentMethod(method);
    const ok = await refresh(() => setAssignmentMethodAction({ method }));
    if (!ok) setAssignmentMethod(previous);
  };

  const handleSave: React.ComponentProps<typeof AutomationBuilder>['onSave'] = async (draft) => {
    const result = await saveAutomationAction(draft);
    if (!result.ok) return result;

    // O servidor é a fonte da ordem e do id: reler evita divergência silenciosa.
    setAutomations((prev) => {
      if (draft.id) {
        return prev.map((item) =>
          item.id === draft.id
            ? {
                ...item,
                name: draft.name,
                trigger: draft.trigger,
                conditions: draft.conditions,
                actions: draft.actions,
                enabled: draft.enabled,
              }
            : item,
        );
      }
      const nextOrder = prev.reduce((max, item) => Math.max(max, item.order), 0) + 1;
      return [
        ...prev,
        {
          id: `au-novo-${nextOrder}`,
          accountId: prev[0]?.accountId ?? '',
          name: draft.name,
          trigger: draft.trigger,
          conditions: draft.conditions,
          actions: draft.actions,
          enabled: draft.enabled,
          order: nextOrder,
        },
      ];
    });

    show({
      tone: 'sucesso',
      title: draft.id ? 'Automação atualizada' : 'Automação criada',
      description: draft.name,
    });
    return { ok: true };
  };

  const handleDelete = async (automation: Automation) => {
    const snapshot = automations;
    setAutomations((prev) => prev.filter((item) => item.id !== automation.id));
    const ok = await refresh(() => deleteAutomationAction({ automationId: automation.id }));
    if (ok) {
      show({ tone: 'sucesso', title: 'Automação excluída', description: automation.name });
    } else {
      setAutomations(snapshot);
    }
  };

  const handleMove = async (automation: Automation, direction: 'cima' | 'baixo') => {
    const list = [...ordered];
    const index = list.findIndex((item) => item.id === automation.id);
    const target = direction === 'cima' ? index - 1 : index + 1;
    const a = list[index];
    const b = list[target];
    if (!a || !b) return;

    list[index] = b;
    list[target] = a;
    setAutomations(list.map((item, position) => ({ ...item, order: position + 1 })));

    const ok = await refresh(() =>
      moveAutomationAction({ automationId: automation.id, direction }),
    );
    if (!ok) setAutomations(ordered);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      {builderOpen ? (
        <AutomationBuilder
          // A chave remonta o formulário ao trocar de alvo, sem estado vazado.
          key={editing?.id ?? 'nova'}
          open
          editing={editing}
          siblings={ordered}
          vocabulary={vocabulary}
          onSave={handleSave}
          onClose={() => {
            setBuilderOpen(false);
            setEditing(undefined);
          }}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          ariaLabel="Seções de automação"
          value={subTab}
          onChange={setSubTab}
          options={SUB_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
        />

        {subTab === 'regras' ? (
          <Button
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              setEditing(undefined);
              setBuilderOpen(true);
            }}
          >
            Nova automação
          </Button>
        ) : null}
      </div>

      {subTab === 'regras' ? (
        <div className="flex flex-col gap-4">
          {conflicts.length > 0 ? (
            <div className="flex items-start gap-3 rounded-surface border border-note-line bg-note p-4 text-body text-note-text shadow-2xs">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-text" />
              <div className="leading-relaxed">
                <span className="font-bold">
                  {conflicts.length === 1
                    ? '1 conflito entre regras ativas.'
                    : `${conflicts.length} conflitos entre regras ativas.`}
                </span>{' '}
                A ordem de execução decide quem vence — use as setas para mudá-la.
                <ul className="mt-2 flex flex-col gap-1">
                  {conflicts.map((conflict, index) => (
                    <li key={index} className="text-meta">
                      {conflict.explanation}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {ordered.length === 0 ? (
            <EmptyState
              icon={<Zap className="size-5" />}
              title="Nenhuma automação ainda"
              description="Regras cuidam do trabalho repetitivo: atribuir por canal, priorizar cliente VIP, avisar quando o SLA está perto de estourar."
              action={
                <Button
                  size="sm"
                  icon={<Plus className="size-3.5" />}
                  onClick={() => {
                    setEditing(undefined);
                    setBuilderOpen(true);
                  }}
                >
                  Criar a primeira regra
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
              <ul className="divide-y divide-line-soft">
                {ordered.map((automation, index) => {
                  const rowConflicts = conflictsOf(conflicts, automation.id);
                  return (
                    <li
                      key={automation.id}
                      className={cn(
                        'flex items-start gap-3 p-4 transition-colors hover:bg-surface-2/60',
                        !automation.enabled && 'opacity-65',
                      )}
                    >
                      {/* A ordem é dado operacional: quem vence o conflito. */}
                      <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
                        <button
                          type="button"
                          aria-label={`Subir ${automation.name} na ordem`}
                          disabled={index === 0}
                          onClick={() => handleMove(automation, 'cima')}
                          className="rounded-control p-0.5 text-dim transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ChevronUp className="size-3" />
                        </button>
                        <span className="font-mono text-micro font-bold text-dim tabular-nums">
                          {String(automation.order).padStart(2, '0')}
                        </span>
                        <button
                          type="button"
                          aria-label={`Descer ${automation.name} na ordem`}
                          disabled={index === ordered.length - 1}
                          onClick={() => handleMove(automation, 'baixo')}
                          className="rounded-control p-0.5 text-dim transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ChevronDown className="size-3" />
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-ui font-bold tracking-tight text-ink">
                            {automation.name}
                          </span>
                          {rowConflicts.length > 0 ? (
                            <Badge tone="amber" withDot>
                              conflito
                            </Badge>
                          ) : null}
                        </div>

                        <p className="mt-1 text-body leading-normal text-muted">
                          {describeAutomation(automation)}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-control bg-surface-2 px-1.5 py-0.5 text-micro font-semibold text-muted">
                            {AUTOMATION_TRIGGER_LABELS[automation.trigger]}
                          </span>
                          {automation.actions.map((action, position) => (
                            <span
                              key={position}
                              className="rounded-control bg-accent-soft px-1.5 py-0.5 text-micro font-semibold text-brand"
                            >
                              {AUTOMATION_ACTION_LABELS[action.type]}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Editar ${automation.name}`}
                          onClick={() => {
                            setEditing(automation);
                            setBuilderOpen(true);
                          }}
                          className="rounded-control p-1.5 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Excluir ${automation.name}`}
                          onClick={() => handleDelete(automation)}
                          className="rounded-control p-1.5 text-dim transition-colors hover:bg-red-soft hover:text-red-text"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                        <Toggle
                          checked={automation.enabled}
                          onChange={() => handleToggleAutomation(automation.id, automation.enabled)}
                          label={`Alternar automação ${automation.name}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {subTab === 'atribuicao' ? (
        <section className="max-w-2xl">
          <SectionTitle
            title="Atribuição automática de conversas"
            hint="como novas conversas chegam aos agentes"
          />
          <div className="flex flex-col gap-2">
            {(
              [
                {
                  id: 'round_robin',
                  label: ASSIGNMENT_METHOD_LABELS.round_robin,
                  desc: 'Distribui em sequência circular entre os agentes online.',
                },
                {
                  id: 'balanceada',
                  label: ASSIGNMENT_METHOD_LABELS.balanceada,
                  desc: 'Prioriza agentes com menor número de conversas ativas no momento.',
                },
                {
                  id: 'manual',
                  label: ASSIGNMENT_METHOD_LABELS.manual,
                  desc: 'Conversas ficam na fila geral até um atendente assumi-las.',
                },
              ] as const
            ).map((option) => (
              <label
                key={option.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-control border p-3 transition-colors',
                  assignmentMethod === option.id
                    ? 'border-brand bg-selected'
                    : 'border-line hover:bg-surface-2',
                )}
              >
                <input
                  type="radio"
                  name="assignmentMethod"
                  checked={assignmentMethod === option.id}
                  onChange={() => handleSetAssignmentMethod(option.id)}
                  className="accent-brand"
                />
                <div>
                  <div className="text-body font-semibold text-ink">{option.label}</div>
                  <div className="text-meta text-dim">{option.desc}</div>
                </div>
              </label>
            ))}
          </div>

          <p className="mt-4 text-meta leading-relaxed text-dim">
            Mensagens automáticas de saudação e de fora do expediente são configuradas por caixa
            de entrada, em{' '}
            <a
              href="/configuracoes?secao=caixas"
              className="font-semibold text-brand hover:underline"
            >
              Caixas de entrada
            </a>
            . Cada canal tem o próprio horário.
          </p>
        </section>
      ) : null}

      {subTab === 'macros' ? (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {macros.map((macro) => {
            const steps = macro.steps.split(' · ');
            return (
              <Card key={macro.id} className="p-4.5">
                <h3 className="mb-3 font-display text-title font-bold tracking-tight text-ink">
                  {macro.name}
                </h3>
                <ol className="flex flex-col gap-2">
                  {steps.map((step, index) => (
                    <li key={step} className="flex items-center gap-2.5 text-body text-muted">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-control border border-line-soft bg-surface-2 text-meta font-bold text-ink">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
