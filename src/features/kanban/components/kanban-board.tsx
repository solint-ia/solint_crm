'use client';

import { useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import type { Deal, Pipeline } from '@/core/domain/pipeline';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoneyFromCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { DealCard } from './deal-card';
import { DealDetailPanel } from './deal-detail-panel';
import { StagesModal } from './stages-modal';
import { useBoard } from '../hooks/use-board';
import { planned } from '@/components/ui/planned';

interface KanbanBoardProps {
  readonly pipelines: readonly Pipeline[];
  readonly pipeline: Pipeline;
  readonly deals: readonly Deal[];
  readonly moveDeal: (input: {
    dealId: string;
    targetStageId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export function KanbanBoard({ pipeline, deals, moveDeal }: KanbanBoardProps) {
  const board = useBoard({ initialDeals: deals, stages: pipeline.stages, moveDeal });
  const [stagesModalOpen, setStagesModalOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-6 py-3">
          <label className="flex items-center gap-1.5 text-meta text-muted">
            Responsável
            <select
              value={board.ownerFilter ?? ''}
              onChange={(event) => board.setOwnerFilter(event.target.value || null)}
              className="rounded-control border border-line bg-surface px-2 py-1.5 text-meta text-ink outline-none focus:border-brand"
            >
              <option value="">Todos</option>
              {board.owners.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Settings2 className="size-3.5" />}
              onClick={() => setStagesModalOpen(true)}
            >
              Configurar etapas
            </Button>
            <Button size="sm" icon={<Plus className="size-3.5" />} {...planned('Criar uma oportunidade sem partir de uma conversa')}>
              Nova oportunidade
            </Button>
          </div>
        </div>

        {board.error ? (
          <p role="alert" className="bg-red-soft px-6 py-2 text-meta text-red-text">
            {board.error}
          </p>
        ) : null}

        <div className="flex flex-1 gap-3 overflow-x-auto bg-app p-4">
          {board.columns.map(({ stage, deals: stageDeals, count, total }) => (
            <section
              key={stage.id}
              onDragOver={(event) => {
                event.preventDefault();
                board.setDragOverStageId(stage.id);
              }}
              onDragLeave={() => board.setDragOverStageId(null)}
              onDrop={() => board.drop(stage.id)}
              className={cn(
                'flex w-[280px] shrink-0 flex-col rounded-surface border bg-surface-2 p-2.5 transition-colors',
                board.dragOverStageId === stage.id
                  ? 'border-brand bg-selected'
                  : 'border-transparent',
              )}
            >
              <header className="mb-2.5 flex items-center gap-2 px-1">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: stage.color }}
                />
                <h2 className="font-display text-body font-semibold text-ink">{stage.name}</h2>
                <span className="ml-auto text-meta text-dim">{count}</span>
              </header>
              <p className="mb-2.5 px-1 font-mono text-meta text-muted">
                {formatMoneyFromCents(total)}
              </p>

              {stageDeals.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {stageDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      stale={board.isStale(deal)}
                      dragging={board.draggingId === deal.id}
                      onDragStart={board.setDraggingId}
                      onDragEnd={() => board.setDraggingId(null)}
                      onOpen={board.setOpenDealId}
                    />
                  ))}
                </ul>
              ) : (
                <p className="rounded-control border border-dashed border-line px-3 py-6 text-center text-meta text-dim">
                  Arraste um card para esta etapa
                </p>
              )}
            </section>
          ))}

          {board.columns.length === 0 ? (
            <EmptyState
              className="w-full"
              title="Este funil ainda não tem etapas"
              description="Crie as etapas do processo — por exemplo: Novo lead, Proposta, Negociação, Ganho — para começar a mover oportunidades."
              action={
                <Button
                  size="sm"
                  icon={<Settings2 className="size-3.5" />}
                  onClick={() => setStagesModalOpen(true)}
                >
                  Configurar etapas
                </Button>
              }
            />
          ) : null}
        </div>
      </div>

      {board.openDeal ? (
        <DealDetailPanel
          deal={board.openDeal}
          stageName={
            pipeline.stages.find((stage) => stage.id === board.openDeal?.stageId)?.name ?? '—'
          }
          onClose={() => board.setOpenDealId(null)}
        />
      ) : null}

      <StagesModal
        open={stagesModalOpen}
        onClose={() => setStagesModalOpen(false)}
        stages={pipeline.stages}
      />
    </div>
  );
}
