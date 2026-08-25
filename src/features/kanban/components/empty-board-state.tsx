'use client';

import { FileSpreadsheet, FilterX, Plus, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyBoardStateProps {
  readonly isFiltered?: boolean;
  readonly onOpenNewDealModal: () => void;
  readonly onClearFilters?: () => void;
  readonly onImportDeals?: () => void;
}

export function EmptyBoardState({
  isFiltered = false,
  onOpenNewDealModal,
  onClearFilters,
  onImportDeals,
}: EmptyBoardStateProps) {
  if (isFiltered) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center animate-in fade-in">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 border border-line text-dim shadow-xs">
          <FilterX className="size-7 text-muted" />
        </div>

        <h3 className="mt-4 font-display text-title font-bold text-ink">
          Nenhuma oportunidade encontrada
        </h3>
        <p className="mt-1.5 max-w-sm text-body text-muted">
          Não encontramos oportunidades que atendam a todos os filtros selecionados no momento.
        </p>

        <div className="mt-5 flex items-center gap-2">
          {onClearFilters && (
            <Button variant="secondary" size="sm" onClick={onClearFilters}>
              Limpar todos os filtros
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={onOpenNewDealModal}
          >
            Nova oportunidade
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center animate-in fade-in">
      <div className="flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500/15 via-indigo-500/10 to-purple-500/15 border border-brand/20 shadow-md">
        <TrendingUp className="size-8 text-brand" />
      </div>

      <h3 className="mt-5 font-display text-metric font-bold text-ink tracking-tight">
        Turbine seu processo comercial
      </h3>
      <p className="mt-2 max-w-md text-body text-muted leading-relaxed">
        Crie sua primeira oportunidade ou importe seus leads para começar a acompanhar o funil de
        vendas, gerenciar atividades e acelerar fechamentos.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onOpenNewDealModal}
          className="inline-flex items-center gap-2 rounded-control bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-body font-semibold text-white shadow-md shadow-blue-500/25 transition-all hover:opacity-95 hover:shadow-lg active:scale-95"
        >
          <Plus className="size-4" />
          <span>Criar primeira oportunidade</span>
        </button>

        {onImportDeals && (
          <Button
            variant="secondary"
            icon={<FileSpreadsheet className="size-4 text-emerald-600" />}
            onClick={onImportDeals}
          >
            Importar oportunidades
          </Button>
        )}
      </div>
    </div>
  );
}
