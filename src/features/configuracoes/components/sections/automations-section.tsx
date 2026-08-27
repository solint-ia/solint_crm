'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Layers,
  Pencil,
  Play,
  Plus,
  Trash2,
  Users,
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
import { ConfirmModal } from '@/components/ui/confirm-modal';
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
  { id: 'regras', label: 'Regras', icon: Zap },
  { id: 'atribuicao', label: 'Distribuição', icon: Users },
  { id: 'macros', label: 'Ações em 1 clique', icon: Layers },
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
  const [deletingAutomation, setDeletingAutomation] = useState<Automation | null>(null);

  // Configurações complementares de atribuição
  const [onlyOnlineAgents, setOnlyOnlineAgents] = useState(true);
  const [agentConcurrencyLimit, setAgentConcurrencyLimit] = useState(10);
  const [autoReassignUnanswered, setAutoReassignUnanswered] = useState(true);
  const [reassignMinutes, setReassignMinutes] = useState(15);

  const { show } = useToast();

  const ordered = useMemo(
    () => [...automations].sort((a, b) => a.order - b.order),
    [automations],
  );

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

  const handleSetAssignmentMethod = async (method: AssignmentMethod) => {
    const previous = assignmentMethod;
    setAssignmentMethod(method);
    const ok = await refresh(() => setAssignmentMethodAction({ method }));
    if (!ok) setAssignmentMethod(previous);
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

      {/* ============================================================ */}
      {/* NAVEGAÇÃO INTERNA: ABAS HORIZONTAIS ESTILO DASHBOARD        */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
        <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface-2 p-1 text-xs">
          {SUB_TABS.map((tab) => {
            const active = subTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3.5 py-1.5 font-semibold transition-all',
                  active
                    ? 'bg-surface text-ink shadow-2xs font-bold ring-1 ring-black/5 dark:ring-white/10'
                    : 'text-muted hover:text-ink',
                )}
              >
                <Icon className={cn('size-3.5', active ? 'text-blue-600 dark:text-blue-400' : 'text-dim')} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {subTab === 'regras' ? (
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
        ) : null}
      </div>

      {/* ============================================================ */}
      {/* ABA 1: REGRAS DE AUTOMAÇÃO                                   */}
      {/* ============================================================ */}
      {subTab === 'regras' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-display text-lg font-bold text-ink">
              Automações e regras
            </h3>
            <p className="text-xs text-muted">
              Automatize tarefas repetitivas e mantenha o atendimento organizado através de gatilhos e ações.
            </p>
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
                A ordem de prioridade decide qual regra prevalece — use as setas para reorganizar.
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
                Crie regras para atribuir conversas, priorizar clientes VIP, etiquetar contatos e automatizar ações repetitivas.
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
                            onChange={() =>
                              handleToggleAutomation(automation.id, automation.enabled)
                            }
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
      ) : null}

      {/* ============================================================ */}
      {/* ABA 2: ATRIBUIÇÃO AUTOMÁTICA DE CONVERSAS                     */}
      {/* ============================================================ */}
      {subTab === 'atribuicao' ? (
        <section className="flex flex-col gap-6 max-w-3xl">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">
              Quem atende cada conversa nova
            </h3>
            <p className="text-xs text-muted">
              Escolha como o sistema entrega as conversas que chegam para a sua equipe.
            </p>
          </div>

          <div className="grid gap-3">
            {[
              {
                id: 'round_robin' as const,
                title: ASSIGNMENT_METHOD_LABELS.round_robin,
                description:
                  'Cada conversa nova vai para o próximo atendente da vez. Quando chega no último, recomeça do primeiro.',
                badge: 'Mais equilibrado',
              },
              {
                id: 'balanceada' as const,
                title: ASSIGNMENT_METHOD_LABELS.balanceada,
                description:
                  'A conversa vai para quem estiver com menos conversas abertas naquele momento.',
                badge: 'Menos sobrecarga',
              },
              {
                id: 'manual' as const,
                title: ASSIGNMENT_METHOD_LABELS.manual,
                description:
                  'As conversas esperam numa fila e cada atendente escolhe qual vai atender.',
                badge: 'Fila livre',
              },
            ].map((option) => {
              const selected = assignmentMethod === option.id;
              return (
                <label
                  key={option.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-4 rounded-2xl border p-4.5 transition-all',
                    selected
                      ? 'border-brand/60 bg-blue-500/5 shadow-2xs ring-1 ring-brand/30 dark:bg-blue-500/10'
                      : 'border-line bg-surface hover:border-brand/30 hover:bg-surface-2 shadow-2xs',
                  )}
                >
                  <input
                    type="radio"
                    name="assignmentMethod"
                    checked={selected}
                    onChange={() => handleSetAssignmentMethod(option.id)}
                    className="mt-1 size-4 accent-brand cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-ink">
                        {option.title}
                      </span>
                      <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted border border-line-soft">
                        {option.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted leading-relaxed">
                      {option.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Configurações complementares */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
            <h4 className="font-display text-sm font-bold text-ink border-b border-line pb-3">
              Ajustes da distribuição
            </h4>

            <div className="divide-y divide-line-soft mt-1">
              <div className="flex items-center justify-between py-3.5">
                <div>
                  <span className="text-xs font-semibold text-ink">
                    Enviar só para quem está online
                  </span>
                  <p className="text-[11px] text-muted">
                    Quem estiver ausente ou fora do sistema não recebe conversas novas.
                  </p>
                </div>
                <Toggle
                  checked={onlyOnlineAgents}
                  onChange={setOnlyOnlineAgents}
                  label="Enviar só para quem está online"
                />
              </div>

              <div className="flex items-center justify-between py-3.5">
                <div>
                  <span className="text-xs font-semibold text-ink">
                    Máximo de conversas ao mesmo tempo
                  </span>
                  <p className="text-[11px] text-muted">
                    Quem já estiver com esse número de conversas abertas para de receber novas.
                  </p>
                </div>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={agentConcurrencyLimit}
                  onChange={(e) => setAgentConcurrencyLimit(Number(e.target.value))}
                  className="h-8 w-20 rounded-xl border border-line bg-surface px-2.5 font-mono text-xs text-ink outline-none focus:border-brand shadow-2xs"
                />
              </div>

              <div className="flex items-center justify-between py-3.5">
                <div>
                  <span className="text-xs font-semibold text-ink">
                    Devolver conversas sem resposta
                  </span>
                  <p className="text-[11px] text-muted">
                    Se ninguém responder no tempo definido, a conversa volta para a fila e outra
                    pessoa pode atender.
                  </p>
                </div>
                <Toggle
                  checked={autoReassignUnanswered}
                  onChange={setAutoReassignUnanswered}
                  label="Devolver conversas sem resposta"
                />
              </div>

              {autoReassignUnanswered ? (
                <div className="flex items-center justify-between py-3.5 pl-4 border-l-2 border-brand/30">
                  <div>
                    <span className="text-xs font-semibold text-ink">
                      Tempo de espera antes de devolver
                    </span>
                    <p className="text-[11px] text-muted">
                      Quantos minutos sem resposta antes de a conversa voltar para a fila.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={reassignMinutes}
                      onChange={(e) => setReassignMinutes(Number(e.target.value))}
                      className="h-8 w-20 rounded-xl border border-line bg-surface px-2.5 font-mono text-xs text-ink outline-none focus:border-brand shadow-2xs"
                    />
                    <span className="text-xs text-muted">min</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* ============================================================ */}
      {/* ABA 3: MACROS DE ATENDIMENTO                                  */}
      {/* ============================================================ */}
      {subTab === 'macros' ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
            <div>
              <h3 className="font-display text-lg font-bold text-ink">
                Ações em 1 clique
              </h3>
              <p className="text-xs text-muted">
                Junte tarefas que você repete o dia todo — responder, etiquetar, encerrar — num
                botão só.
              </p>
            </div>

            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              onClick={() =>
                show({
                  tone: 'info',
                  title: 'Criador de ações',
                  description: 'O criador de ações personalizadas chega na próxima versão.',
                })
              }
            >
              Nova ação
            </Button>
          </div>

          {macros.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2/40 p-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-dim mb-3">
                <Layers className="size-6" />
              </div>
              <h4 className="font-display text-base font-bold text-ink">
                Nenhuma ação criada ainda
              </h4>
              <p className="mt-1 max-w-md text-xs text-muted">
                Transforme o que a equipe repete todo dia em um botão só.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {macros.map((macro) => {
                const steps = macro.steps.split(' · ');
                return (
                  <div
                    key={macro.id}
                    className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-5 shadow-2xs transition-all hover:border-brand/40 hover:shadow-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-display text-sm font-bold tracking-tight text-ink">
                          {macro.name}
                        </h4>
                        <Badge tone="blue">Disponível</Badge>
                      </div>

                      <ol className="mt-3.5 flex flex-col gap-2">
                        {steps.map((step, index) => (
                          <li
                            key={step}
                            className="flex items-center gap-2 text-xs text-muted"
                          >
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-surface-2 font-mono text-[10px] font-bold text-ink">
                              {index + 1}
                            </span>
                            <span className="truncate">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-line-soft pt-3 text-[11px] text-dim">
                      <span>Faz {steps.length} tarefas de uma vez</span>
                      <button
                        type="button"
                        onClick={() =>
                          show({
                            tone: 'info',
                            title: macro.name,
                            description: 'Macro pronta para ser acionada dentro das conversas.',
                          })
                        }
                        className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Ver detalhes
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* Confirmação de Exclusão */}
      <ConfirmModal
        open={deletingAutomation !== null}
        title="Excluir regra de automação"
        description={
          <span>
            Tem certeza que deseja excluir a regra{' '}
            <strong className="text-ink">&ldquo;{deletingAutomation?.name}&rdquo;</strong>? As ações automáticas vinculadas ao gatilho deixarão de ser disparadas.
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
