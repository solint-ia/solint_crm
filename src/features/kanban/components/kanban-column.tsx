'use client';

import { useState } from 'react';
import { MoreHorizontal, Plus, TrendingUp } from 'lucide-react';
import type { Deal, PipelineStage } from '@/core/domain/pipeline';
import { formatMoneyFromCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { DealCard } from './deal-card';

interface KanbanColumnProps {
  readonly stage: PipelineStage;
  readonly deals: readonly Deal[];
  readonly count: number;
  readonly total: number;
  readonly isStale: (deal: Deal) => boolean;
  readonly isDragging: boolean;
  readonly isDragOver: boolean;
  readonly draggingId: string | null;
  readonly onDragOver: (event: React.DragEvent) => void;
  readonly onDragLeave: () => void;
  readonly onDrop: () => void;
  readonly onDragStart: (dealId: string) => void;
  readonly onDragEnd: () => void;
  readonly onOpenDeal: (dealId: string) => void;
  readonly onEditDeal?: (deal: Deal) => void;
  readonly onDeleteDeal?: (dealId: string) => void;
  readonly onAddDealToStage: (stageId: string) => void;
  readonly onOpenStagesModal: () => void;
}

export function KanbanColumn({
  stage,
  deals,
  count,
  total,
  isStale,
  isDragOver,
  draggingId,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onOpenDeal,
  onEditDeal,
  onDeleteDeal,
  onAddDealToStage,
  onOpenStagesModal,
}: KanbanColumnProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <section
      aria-label={`Etapa ${stage.name}, ${count} oportunidades`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'flex w-[300px] shrink-0 flex-col rounded-xl border bg-surface-2/70 p-2.5 transition-all duration-150',
        isDragOver
          ? 'border-brand bg-brand/5 ring-2 ring-brand/30 shadow-md'
          : 'border-line/70 hover:border-line',
      )}
    >
      {/* Cabeçalho da Coluna (Fixo) */}
      <header className="mb-2 flex flex-col gap-1.5 rounded-lg bg-surface p-2.5 shadow-2xs border border-line-soft">
        <div className="flex items-center justify-between gap-1.5">
          {/* Nome e Indicador de Cor */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="size-2.5 shrink-0 rounded-full ring-2 ring-surface shadow-xs"
              style={{ backgroundColor: stage.color }}
            />
            <h2 className="truncate font-display text-body font-bold text-ink tracking-tight">
              {stage.name}
            </h2>
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-micro font-bold text-muted border border-line-soft">
              {count}
            </span>
          </div>

          {/* Menu de Ações da Coluna */}
          <div className="relative">
            <button
              type="button"
              aria-label={`Opções da etapa ${stage.name}`}
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded p-1 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <MoreHorizontal className="size-3.5" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setMenuOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-float border border-line bg-surface p-1 shadow-xl text-body text-ink">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onAddDealToStage(stage.id);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2"
                  >
                    <Plus className="size-3.5 text-brand" />
                    <span>Adicionar nesta etapa</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenStagesModal();
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2"
                  >
                    <TrendingUp className="size-3.5 text-dim" />
                    <span>Configurar etapas</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Valor Total da Etapa */}
        <div className="border-t border-line-soft pt-1.5 text-meta text-muted">
          <span className="font-display font-bold text-ink tracking-tight tabular-nums">
            {formatMoneyFromCents(total)}
          </span>
        </div>
      </header>

      {/* Área de Cards com Rolagem Vertical Independente */}
      <div className="flex flex-1 flex-col overflow-y-auto pr-0.5 max-h-[calc(100vh-250px)]">
        {deals.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {deals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                stale={isStale(deal)}
                dragging={draggingId === deal.id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onOpen={onOpenDeal}
                onEdit={onEditDeal}
                onDelete={onDeleteDeal}
              />
            ))}
          </ul>
        ) : (
          /* Estado Vazio da Coluna */
          <div
            className={cn(
              'flex flex-col items-center justify-center rounded-lg border border-dashed border-line/80 p-4 text-center text-meta text-dim transition-colors',
              isDragOver ? 'border-brand bg-brand/10 text-brand' : 'bg-surface/30',
            )}
          >
            <p className="font-medium text-muted">Nenhuma oportunidade</p>
            <p className="mt-0.5 text-micro text-dim">Arraste um card para cá</p>
            <button
              type="button"
              onClick={() => onAddDealToStage(stage.id)}
              className="mt-2.5 inline-flex items-center gap-1 rounded-control bg-surface border border-line px-2.5 py-1 text-micro font-semibold text-ink shadow-2xs transition-all hover:border-brand/40 hover:text-brand"
            >
              <Plus className="size-3" />
              <span>Adicionar</span>
            </button>
          </div>
        )}
      </div>

      {/* Botão Rápido de Adição na Base da Coluna */}
      {deals.length > 0 && (
        <button
          type="button"
          onClick={() => onAddDealToStage(stage.id)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-transparent py-1.5 text-meta font-medium text-dim transition-colors hover:border-line hover:bg-surface hover:text-ink"
        >
          <Plus className="size-3.5" />
          <span>Nova oportunidade</span>
        </button>
      )}
    </section>
  );
}
