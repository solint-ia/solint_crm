'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Pencil,
  Play,
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  deleteAutomationAction,
  moveAutomationAction,
  saveAutomationAction,
  toggleAutomationAction,
} from '@/app/(workspace)/configuracoes/actions';
import { AutomationBuilder, type BuilderVocabulary } from '../automations/automation-builder';

interface AutomationsSectionProps {
  readonly initialAutomations: readonly Automation[];
  readonly vocabulary: BuilderVocabulary;
}

export function AutomationsSection({ initialAutomations, vocabulary }: AutomationsSectionProps) {
  const [automations, setAutomations] = useState<readonly Automation[]>(initialAutomations);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | undefined>();
  const [deletingAutomation, setDeletingAutomation] = useState<Automation | null>(null);

  const { show } = useToast();

  const ordered = useMemo(() => [...automations].sort((a, b) => a.order - b.order), [automations]);

  const conflicts = useMemo(() => detectAutomationConflicts(ordered), [ordered]);

  const refresh = async (mutate: () => Promise<{ ok: boolean; error?: string }>) => {
    const result = await mutate();
    if (!result.ok) {
      show({ tone: 'erro', title: 'Não foi possível salvar', description: result.error });
      return false;
    }
    return true;
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

  const handleSave: React.ComponentProps<typeof AutomationBuilder>['onSave'] = async (draft) => {
    const result = await saveAutomationAction(draft);
    if (!result.ok) return result;

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

  const handleConfirmDelete = async () => {
    if (!deletingAutomation) return;
    const automation = deletingAutomation;
    setDeletingAutomation(null);
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
    <div className="flex flex-col gap-6 animate-in fade-in duration-200">
      {builderOpen ? (
        <AutomationBuilder
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

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-display text-lg font-bold text-ink">Automações e regras</h3>
            <p className="text-xs text-muted">
              Automatize tarefas repetitivas e mantenha o atendimento organizado através de gatilhos
              e ações.
            </p>
          </div>
          <Button
            size="md"
            icon={<Plus className="size-4" />}
            onClick={() => {
              setEditing(undefined);
              setBuilderOpen(true);
            }}
          >
            Nova automação
          </Button>
        </div>

        {conflicts.length > 0 ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 shadow-2xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="leading-relaxed">
              <span className="font-bold">
                {conflicts.length === 1
                  ? '1 conflito detectado entre regras ativas.'
                  : `${conflicts.length} conflitos detectados entre regras ativas.`}
              </span>{' '}
              A ordem de prioridade decide qual regra prevalece. Use as setas para reorganizar.
              <ul className="mt-1.5 flex flex-col gap-0.5 list-disc pl-4 text-meta">
                {conflicts.map((conflict, index) => (
                  <li key={index}>{conflict.explanation}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {ordered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2/40 p-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 mb-3">
              <Zap className="size-6" />
            </div>
            <h4 className="font-display text-base font-bold text-ink">
              Nenhuma automação criada ainda
            </h4>
            <p className="mt-1 max-w-md text-xs text-muted">
              Crie regras para priorizar clientes VIP, etiquetar contatos e automatizar ações
              repetitivas.
            </p>
            <Button
              size="md"
              className="mt-5"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setEditing(undefined);
                setBuilderOpen(true);
              }}
            >
              Criar primeira regra
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-2xs">
            <ul className="divide-y divide-line-soft">
              {ordered.map((automation, index) => {
                const rowConflicts = conflictsOf(conflicts, automation.id);
                return (
                  <li
                    key={automation.id}
                    className={cn(
                      'flex items-start gap-4 p-4.5 transition-colors hover:bg-surface-2/60',
                      !automation.enabled && 'opacity-65',
                    )}
                  >
                    {/* Botões de Ordem */}
                    <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
                      <button
                        type="button"
                        aria-label={`Subir ${automation.name} na ordem`}
                        disabled={index === 0}
                        onClick={() => handleMove(automation, 'cima')}
                        className="rounded-lg p-1 text-dim transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-20"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <span className="font-mono text-[11px] font-bold text-dim tabular-nums">
                        {String(automation.order).padStart(2, '0')}
                      </span>
                      <button
                        type="button"
                        aria-label={`Descer ${automation.name} na ordem`}
                        disabled={index === ordered.length - 1}
                        onClick={() => handleMove(automation, 'baixo')}
                        className="rounded-lg p-1 text-dim transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-20"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold tracking-tight text-ink">
                          {automation.name}
                        </span>
                        {rowConflicts.length > 0 ? (
                          <Badge tone="amber" withDot>
                            Conflito
                          </Badge>
                        ) : null}
                        <Badge tone={automation.enabled ? 'green' : 'slate'} withDot>
                          {automation.enabled ? 'Ativa' : 'Pausada'}
                        </Badge>
                      </div>

                      <p className="mt-1 text-xs text-muted leading-relaxed">
                        {describeAutomation(automation)}
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink border border-line-soft">
                          <Play className="size-2.5 text-blue-500" />
                          {AUTOMATION_TRIGGER_LABELS[automation.trigger]}
                        </span>
                        <ArrowRight className="size-3 text-dim" />
                        {automation.actions.map((action, position) => (
                          <span
                            key={position}
                            className="rounded-lg bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400"
                          >
                            {AUTOMATION_ACTION_LABELS[action.type]}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Editar ${automation.name}`}
                        onClick={() => {
                          setEditing(automation);
                          setBuilderOpen(true);
                        }}
                        icon={<Pencil className="size-3.5" />}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Excluir ${automation.name}`}
                        onClick={() => setDeletingAutomation(automation)}
                        icon={<Trash2 className="size-3.5 text-red-500" />}
                      />
                      <div className="pl-2 border-l border-line-soft">
                        <Toggle
                          checked={automation.enabled}
                          onChange={() => handleToggleAutomation(automation.id, automation.enabled)}
                          label={`Alternar automação ${automation.name}`}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* Confirmação de Exclusão */}
      <ConfirmModal
        open={deletingAutomation !== null}
        title="Excluir regra de automação"
        description={
          <span>
            Tem certeza que deseja excluir a regra{' '}
            <strong className="text-ink">&ldquo;{deletingAutomation?.name}&rdquo;</strong>? As ações
            automáticas vinculadas ao gatilho deixarão de ser disparadas.
          </span>
        }
        confirmLabel="Excluir regra"
        variant="danger"
        onClose={() => setDeletingAutomation(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
