'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Settings2 } from 'lucide-react';
import type { Deal, Pipeline } from '@/core/domain/pipeline';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoneyFromCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { DealCard } from './deal-card';
import { DealDetailPanel } from './deal-detail-panel';
import { StagesModal } from './stages-modal';
import { useBoard } from '../hooks/use-board';
import { createDealAction } from '@/app/(workspace)/kanban/actions';

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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const board = useBoard({ initialDeals: deals, stages: pipeline.stages, moveDeal });
  const [stagesModalOpen, setStagesModalOpen] = useState(false);

  // New Deal Modal
  const [isNewDealOpen, setIsNewDealOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [valueStr, setValueStr] = useState('');
  const [stageId, setStageId] = useState(pipeline.stages[0]?.id ?? '');
  const [contactName, setContactName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreateDeal = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedValue = Math.round((parseFloat(valueStr.replace(',', '.')) || 0) * 100);

    startTransition(async () => {
      const res = await createDealAction(pipeline.id, {
        stageId,
        title,
        value: parsedValue,
        contactName: contactName || undefined,
        companyName: companyName || undefined,
        ownerName: ownerName || undefined,
      });
      if (res.ok) {
        setIsNewDealOpen(false);
        setTitle('');
        setValueStr('');
        setContactName('');
        setCompanyName('');
        setOwnerName('');
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao criar oportunidade.');
      }
    });
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* Modal Nova Oportunidade */}
      <Modal
        open={isNewDealOpen}
        onClose={() => setIsNewDealOpen(false)}
        title="Nova oportunidade de negócio"
      >
        <form onSubmit={handleCreateDeal} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-md bg-danger/10 p-3 text-body text-danger">
              {error}
            </div>
          )}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Título da oportunidade</label>
            <input
              type="text"
              required
              placeholder="Ex: Contrato Anual - Empresa XPTO"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Valor estimado (R$)</label>
              <input
                type="text"
                placeholder="5000,00"
                value={valueStr}
                onChange={(e) => setValueStr(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-body text-ink focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Etapa inicial</label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              >
                {pipeline.stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Contato principal</label>
              <input
                type="text"
                placeholder="Nome do cliente"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Empresa</label>
              <input
                type="text"
                placeholder="Razão Social ou Fantasia"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Vendedor responsável</label>
            <input
              type="text"
              placeholder="Nome do vendedor"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsNewDealOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !title.trim()}>
              {isPending ? 'Salvando...' : 'Criar oportunidade'}
            </Button>
          </div>
        </form>
      </Modal>

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
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              onClick={() => setIsNewDealOpen(true)}
            >
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
