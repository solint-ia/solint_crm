'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FilterX, Settings2 } from 'lucide-react';
import type { Deal, Pipeline } from '@/core/domain/pipeline';
import type { Label } from '@/core/domain/label';

import type { AppNotification } from '@/core/domain/notification';
import type { Account } from '@/core/domain/user';
import type { NavItem } from '@/config/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { KanbanHeader } from './kanban-header';
import { KanbanMetricsStrip } from './kanban-metrics-strip';
import { KanbanToolbar } from './kanban-toolbar';
import { KanbanColumn } from './kanban-column';
import { DealDetailPanel } from './deal-detail-panel';
import { NewDealModal } from './new-deal-modal';
import { EditDealModal } from './edit-deal-modal';
import { StagesModal } from './stages-modal';
import { useBoard } from '../hooks/use-board';
import {
  createDealAction,
  deleteDealAction,
  updateDealAction,
  updateStagesAction,
} from '@/app/(workspace)/kanban/actions';

interface KanbanBoardProps {
  readonly pipelines: readonly Pipeline[];
  readonly pipeline: Pipeline;
  readonly deals: readonly Deal[];
  readonly account: Account;
  readonly accounts: readonly Account[];
  readonly notifications: readonly AppNotification[];
  readonly navItems: readonly NavItem[];
  /** Etiquetas da conta, para vincular cada etapa à sua. */
  readonly labels: readonly Label[];
  readonly moveDeal: (input: {
    dealId: string;
    targetStageId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export function KanbanBoard({
  pipelines,
  pipeline,
  deals,
  account,
  accounts,
  notifications,
  navItems,
  labels,
  moveDeal,
}: KanbanBoardProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const board = useBoard({ initialDeals: deals, stages: pipeline.stages, moveDeal });

  // Modo Mobile: seleção de etapa ativa na visualização compacta
  const [mobileActiveStageId, setMobileActiveStageId] = useState<string>(
    pipeline.stages[0]?.id ?? '',
  );

  // Ação de Criar Oportunidade
  const handleCreateDeal = async (data: {
    title: string;
    valueInCents: number;
    stageId: string;
    contactName?: string;
    companyName?: string;
    ownerName?: string;
    priority?: 'baixa' | 'media' | 'alta' | 'urgente';
    probability?: number;
    source?: string;
    nextAction?: string;
  }) => {
    const res = await createDealAction(pipeline.id, {
      title: data.title,
      value: data.valueInCents,
      stageId: data.stageId,
      contactName: data.contactName,
      companyName: data.companyName,
      ownerName: data.ownerName,
      priority: data.priority,
      probability: data.probability,
      source: data.source,
      nextAction: data.nextAction,
    });

    if (res.ok && res.deal) {
      board.handleOptimisticCreate(res.deal);
      router.refresh();
    } else if (res.ok) {
      router.refresh();
    } else {
      throw new Error(res.error ?? 'Erro ao criar oportunidade.');
    }
  };

  // Ação de Editar Oportunidade
  const handleEditDeal = async (data: {
    dealId: string;
    title: string;
    valueInCents: number;
    stageId: string;
    contactName?: string;
    companyName?: string;
    ownerName?: string;
    priority?: 'baixa' | 'media' | 'alta' | 'urgente';
    probability?: number;
    source?: string;
    nextAction?: string;
  }) => {
    const res = await updateDealAction({
      dealId: data.dealId,
      title: data.title,
      value: data.valueInCents,
      stageId: data.stageId,
      contactName: data.contactName,
      companyName: data.companyName,
      ownerName: data.ownerName,
      priority: data.priority,
      probability: data.probability,
      source: data.source,
      nextAction: data.nextAction,
    });

    if (res.ok && res.deal) {
      board.handleOptimisticUpdate(res.deal);
      router.refresh();
    } else if (res.ok) {
      router.refresh();
    } else {
      throw new Error(res.error ?? 'Erro ao atualizar oportunidade.');
    }
  };


  // Ação de Excluir Oportunidade
  const handleDeleteDeal = async (dealId: string) => {
    board.handleOptimisticDelete(dealId);
    startTransition(async () => {
      await deleteDealAction({ dealId });
      router.refresh();
    });
  };

  // Ação de Salvar Etapas
  const handleSaveStages = async (
    updatedStages: readonly {
      id?: string;
      name: string;
      order: number;
      color: string;
      isWon: boolean;
      isLost: boolean;
      defaultProbability?: number;
      labelId?: string | null;
    }[],
  ) => {
    const res = await updateStagesAction(pipeline.id, { stages: updatedStages });
    if (res.ok) {
      board.setStages(
        updatedStages.map((s, idx) => ({
          id: s.id ?? `st-stage-${idx}`,
          pipelineId: pipeline.id,
          name: s.name,
          order: s.order,
          color: s.color,
          isWon: s.isWon,
          isLost: s.isLost,
          defaultProbability: s.defaultProbability,
        })),
      );
      router.refresh();
    } else {
      throw new Error(res.error ?? 'Erro ao atualizar etapas.');
    }
  };

  const isFiltered =
    Boolean(board.filters.searchQuery.trim()) ||
    Boolean(board.filters.owner) ||
    Boolean(board.filters.team) ||
    Boolean(board.filters.source) ||
    Boolean(board.filters.priority) ||
    Boolean(board.filters.period && board.filters.period !== 'todos') ||
    Boolean(board.filters.valueRange && board.filters.valueRange !== 'todos');

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-app">
      {/* Nível 1: Cabeçalho Principal do Funil */}
      <KanbanHeader
        currentPipeline={pipeline}
        pipelines={pipelines}
        account={account}
        accounts={accounts}
        notifications={notifications}
        navItems={navItems}
      />

      {/* Faixa de Resumo do Funil (KPIs) */}
      <KanbanMetricsStrip summary={board.summary} isFiltered={isFiltered} />

      {/* Nível 2: Barra de Filtros e Ações */}
      <KanbanToolbar
        filters={board.filters}
        sortOption={board.sortOption}
        owners={board.owners}
        teams={board.teams}
        onFilterChange={board.setFilter}
        onSortChange={board.setSortOption}
        onClearFilters={board.clearAllFilters}
        onOpenStagesModal={() => board.setStagesModalOpen(true)}
        onOpenNewDealModal={() => {
          board.setNewDealStageId(undefined);
          board.setNewDealModalOpen(true);
        }}
      />

      {/* Toast Notificação de Movimentação */}
      {board.notification && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-body font-medium text-white shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-150">
          <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
          <span>{board.notification}</span>
        </div>
      )}

      {/* Mensagem de Erro */}
      {board.error ? (
        <div role="alert" className="border-b border-red-line/50 bg-red-soft px-6 py-2 text-meta text-red-text">
          {board.error}
        </div>
      ) : null}

      {/* Seletor de Abas em Telas Mobile / Pequenas */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 md:hidden">
        {board.columns.map(({ stage, count }) => (
          <button
            key={stage.id}
            type="button"
            onClick={() => setMobileActiveStageId(stage.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-semibold transition-all shrink-0',
              mobileActiveStageId === stage.id
                ? 'bg-brand text-white shadow-xs'
                : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />
            <span>{stage.name}</span>
            <span
              className={cn(
                'rounded-full px-1.5 text-[10px]',
                mobileActiveStageId === stage.id ? 'bg-white/20 text-white' : 'bg-line text-dim',
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Nível 3: Quadro Kanban Principal */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Aviso amigável quando filtros zeram os resultados */}
        {isFiltered && board.visibleDeals.length === 0 && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-line bg-surface p-3 text-xs text-muted shadow-2xs">
            <div className="flex items-center gap-2">
              <FilterX className="size-4 text-dim" />
              <span>Nenhuma oportunidade encontrada para os filtros selecionados.</span>
            </div>
            <Button variant="ghost" size="sm" onClick={board.clearAllFilters}>
              Limpar filtros
            </Button>
          </div>
        )}

        {board.columns.length === 0 ? (
          /* Estado Vazio quando não há etapas no funil */
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md text-center">
              <h3 className="font-display text-title font-bold text-ink">
                Este funil ainda não possui etapas
              </h3>
              <p className="mt-1 text-body text-muted">
                Adicione as etapas do seu processo comercial para começar a visualizar e movimentar
                as oportunidades.
              </p>
              <Button
                variant="primary"
                size="sm"
                icon={<Settings2 className="size-3.5" />}
                onClick={() => board.setStagesModalOpen(true)}
                className="mt-4"
              >
                Configurar etapas do funil
              </Button>
            </div>
          </div>
        ) : (
          /* Quadro com Colunas / Raias Predefinidas (Sempre Visíveis) */
          <main
            aria-label="Quadro de oportunidades"
            className="flex flex-1 gap-3.5 overflow-x-auto p-4 sm:p-5 md:gap-4"
          >
            {/* Em Desktop / Tablet: exibe todas as colunas com rolagem lateral */}
            {board.columns.map(({ stage, deals: stageDeals, count, total }) => {
              const isMobileHidden =
                typeof window !== 'undefined' &&
                window.innerWidth < 768 &&
                mobileActiveStageId &&
                mobileActiveStageId !== stage.id;

              return (
                <div key={stage.id} className={cn(isMobileHidden ? 'hidden md:flex' : 'flex')}>
                  <KanbanColumn
                    stage={stage}
                    deals={stageDeals}
                    count={count}
                    total={total}
                    isStale={board.isStale}
                    isDragging={board.draggingId !== null}
                    isDragOver={board.dragOverStageId === stage.id}
                    draggingId={board.draggingId}
                    onDragOver={(e) => {
                      e.preventDefault();
                      board.setDragOverStageId(stage.id);
                    }}
                    onDragLeave={() => board.setDragOverStageId(null)}
                    onDrop={() => board.drop(stage.id)}
                    onDragStart={board.setDraggingId}
                    onDragEnd={() => board.setDraggingId(null)}
                    onOpenDeal={board.setOpenDealId}
                    onEditDeal={(deal) => board.setEditingDeal(deal)}
                    onDeleteDeal={handleDeleteDeal}
                    onAddDealToStage={(stId) => {
                      board.setNewDealStageId(stId);
                      board.setNewDealModalOpen(true);
                    }}
                    onOpenStagesModal={() => board.setStagesModalOpen(true)}
                  />
                </div>
              );
            })}
          </main>
        )}

        {/* Painel Lateral de Detalhes da Oportunidade */}
        {board.openDeal && (
          <DealDetailPanel
            deal={board.openDeal}
            stages={board.stages}
            onClose={() => board.setOpenDealId(null)}
            onEdit={(deal) => board.setEditingDeal(deal)}
            onDelete={handleDeleteDeal}
            onMoveStage={(dealId, targetStageId) => {
              board.setDraggingId(dealId);
              board.drop(targetStageId);
            }}
          />
        )}
      </div>

      {/* Modal Nova Oportunidade */}
      <NewDealModal
        open={board.newDealModalOpen}
        onClose={() => {
          board.setNewDealModalOpen(false);
          board.setNewDealStageId(undefined);
        }}
        stages={board.stages}
        initialStageId={board.newDealStageId}
        owners={board.owners}
        onSubmit={handleCreateDeal}
      />

      {/* Modal Editar Oportunidade */}
      <EditDealModal
        open={board.editingDeal !== null}
        deal={board.editingDeal}
        stages={board.stages}
        owners={board.owners}
        onClose={() => board.setEditingDeal(null)}
        onSubmit={handleEditDeal}
      />

      {/* Modal Configuração de Etapas */}
      <StagesModal
        open={board.stagesModalOpen}
        stages={board.stages}
        labels={labels}
        onClose={() => board.setStagesModalOpen(false)}
        onSaveStages={handleSaveStages}
      />
    </div>
  );
}
