'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  MessageCircle,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import type { Deal, PipelineStage } from '@/core/domain/pipeline';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { PRIORITY_LABEL, PRIORITY_TONE } from '@/components/domain/presentation-maps';
import { formatMoneyFromCents } from '@/lib/format';
import { cn } from '@/lib/cn';

interface DealDetailPanelProps {
  readonly deal: Deal;
  readonly stages: readonly PipelineStage[];
  readonly onClose: () => void;
  readonly onEdit?: (deal: Deal) => void;
  readonly onDelete?: (dealId: string) => void;
  readonly onMoveStage?: (dealId: string, targetStageId: string) => void;
}

export function DealDetailPanel({
  deal,
  stages,
  onClose,
  onEdit,
  onDelete,
  onMoveStage,
}: DealDetailPanelProps) {
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const currentStageIndex = stages.findIndex((s) => s.id === deal.stageId);
  const currentStage = stages[currentStageIndex] ?? stages[0];

  // Tarefas locais (checklist)
  const [tasks, setTasks] = useState(
    deal.tasks ?? [
      { id: 'tsk-default', title: 'Entrar em contato para qualificação', completed: false },
    ],
  );
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isAddingTask, setIsAddingTask] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleToggleTask = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t)),
    );
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    setTasks((prev) => [
      ...prev,
      { id: `tsk-${Date.now()}`, title: newTaskTitle.trim(), completed: false },
    ]);
    setNewTaskTitle('');
    setIsAddingTask(false);
  };

  return (
    <>
      {/* Backdrop para mobile / tablet */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        aria-label={`Detalhes da oportunidade: ${deal.title ?? deal.contactName}`}
        className="fixed right-0 top-0 bottom-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl animate-in slide-in-from-right duration-200 lg:relative lg:w-[380px] lg:z-auto lg:shadow-none"
      >
        {/* Cabeçalho do Painel */}
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 bg-surface">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={deal.contactName} size="md" />
            <div className="min-w-0">
              <h2 className="font-display text-title font-bold text-ink tracking-tight truncate">
                {deal.title ?? deal.contactName}
              </h2>
              <div className="flex items-center gap-1.5 text-meta text-muted truncate">
                <span className="font-medium">{deal.contactName}</span>
                {deal.company && (
                  <>
                    <span>•</span>
                    <span className="text-dim truncate">{deal.company}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(deal)}
                title="Editar oportunidade"
                className="rounded-control p-1 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Pencil className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar detalhes"
              className="rounded-control p-1 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        {/* Conteúdo com Scroll */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Valor Estimado & Probabilidade */}
          <div className="rounded-xl border border-line bg-surface-2/60 p-4">
            <div className="flex items-end justify-between">
              <div>
                <span className="block text-micro font-semibold uppercase text-dim tracking-wider">
                  Valor da Oportunidade
                </span>
                <span className="font-display text-metric font-bold text-ink tracking-tight tabular-nums">
                  {formatMoneyFromCents(deal.amountInCents)}
                </span>
              </div>

              <div className="flex flex-col items-end">
                <span className="inline-flex items-center gap-1 rounded bg-brand/10 px-2 py-0.5 text-meta font-bold text-brand">
                  <Sparkles className="size-3" />
                  {deal.probability ?? 50}% Probabilidade
                </span>
              </div>
            </div>

            {/* Badges de Metadados */}
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line-soft pt-3">
              <Badge tone={PRIORITY_TONE[deal.priority]}>
                Prioridade: {PRIORITY_LABEL[deal.priority]}
              </Badge>
              <Badge tone="blue">Responsável: {deal.ownerName}</Badge>
              {deal.source && <Badge tone="green">Origem: {deal.source}</Badge>}
            </div>
          </div>

          {/* Stepper Visual de Progresso de Etapas */}
          <div>
            <span className="block text-micro font-semibold uppercase text-dim tracking-wider mb-2.5">
              Etapa Atual do Funil
            </span>
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-5 gap-1">
                {stages.map((st, idx) => {
                  const isCurrent = st.id === deal.stageId;
                  const isPassed = currentStageIndex >= idx;

                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => onMoveStage && onMoveStage(deal.id, st.id)}
                      title={`Mover para: ${st.name}`}
                      className="group relative flex flex-col items-center focus:outline-none"
                    >
                      <div
                        className={cn(
                          'h-2 w-full rounded-full transition-all duration-200',
                          isCurrent
                            ? 'bg-brand ring-2 ring-brand/30 shadow-xs'
                            : isPassed
                              ? 'bg-brand/60'
                              : 'bg-line',
                        )}
                        style={isCurrent ? { backgroundColor: st.color } : {}}
                      />
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between text-meta">
                <span className="font-semibold text-ink flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: currentStage?.color }}
                  />
                  {currentStage?.name}
                </span>
                <span className="font-mono text-dim">{deal.stageAgeLabel}</span>
              </div>
            </div>
          </div>

          {/* Próxima Ação */}
          <div className="rounded-lg border border-line bg-surface p-3.5">
            <span className="block text-micro font-semibold uppercase text-dim tracking-wider mb-1.5 flex items-center gap-1.5">
              <Calendar className="size-3.5 text-brand" />
              Próxima Atividade
            </span>
            <p className="text-body text-ink font-medium">{deal.nextAction}</p>
          </div>

          {/* Checklist de Tarefas */}
          <div className="rounded-lg border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-micro font-semibold uppercase text-dim tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                Tarefas da Oportunidade
              </span>
              <button
                type="button"
                onClick={() => setIsAddingTask((v) => !v)}
                className="text-micro font-semibold text-brand hover:underline"
              >
                + Adicionar
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  onClick={() => handleToggleTask(task.id)}
                  className="flex items-center gap-2.5 cursor-pointer rounded p-1 hover:bg-surface-2 transition-colors"
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                      task.completed
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-line bg-surface',
                    )}
                  >
                    {task.completed && <Check className="size-3 stroke-[3]" />}
                  </span>
                  <span
                    className={cn(
                      'text-body',
                      task.completed ? 'line-through text-dim' : 'text-ink font-medium',
                    )}
                  >
                    {task.title}
                  </span>
                </li>
              ))}
            </ul>

            {isAddingTask && (
              <form onSubmit={handleAddTask} className="mt-2.5 flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Nova tarefa..."
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  autoFocus
                  className="h-8 flex-1 rounded border border-line bg-surface px-2.5 text-body text-ink outline-none focus:border-brand"
                />
                <Button type="submit" size="sm">
                  Salvar
                </Button>
              </form>
            )}
          </div>

          {/* Histórico da Oportunidade */}
          <div>
            <span className="block text-micro font-semibold uppercase text-dim tracking-wider mb-2.5 flex items-center gap-1.5">
              <Clock className="size-3.5 text-dim" />
              Histórico de Atividades
            </span>
            <ul className="flex flex-col gap-2 border-l-2 border-line pl-3 ml-1.5">
              {deal.history.map((entry, idx) => (
                <li key={`${entry.date}-${idx}`} className="relative">
                  <span className="absolute -left-[19px] top-1.5 size-2 rounded-full bg-brand ring-4 ring-surface" />
                  <p className="text-body text-ink">{entry.text}</p>
                  <p className="text-micro text-dim mt-0.5">{entry.date}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Rodapé de Ações Rápidas */}
        <footer className="border-t border-line p-4 bg-surface-2 flex flex-col gap-2">
          {deal.conversationId ? (
            <Link href="/conversas" className="w-full">
              <Button
                variant="primary"
                fullWidth
                icon={<MessageCircle className="size-4" />}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Abrir conversa no WhatsApp
              </Button>
            </Link>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            {onDelete && (
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => setIsConfirmDeleteOpen(true)}
              >
                Excluir oportunidade
              </Button>
            )}

            <Button variant="secondary" size="sm" onClick={onClose} className="ml-auto">
              Fechar
            </Button>
          </div>
        </footer>
      </aside>

      {/* Modal de Confirmação de Exclusão de Oportunidade */}
      {onDelete && (
        <ConfirmModal
          open={isConfirmDeleteOpen}
          title="Excluir oportunidade"
          description={
            <span>
              Tem certeza que deseja excluir a oportunidade{' '}
              <strong className="text-ink">&ldquo;{deal.title ?? deal.contactName}&rdquo;</strong>? O histórico de atividades, tarefas e valores do funil serão permanentemente removidos.
            </span>

          }
          confirmLabel="Excluir oportunidade"
          variant="danger"
          onClose={() => setIsConfirmDeleteOpen(false)}
          onConfirm={() => {
            onDelete(deal.id);
            setIsConfirmDeleteOpen(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

