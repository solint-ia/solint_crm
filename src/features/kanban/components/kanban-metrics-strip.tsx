'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  PieChart,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { PipelineSummary } from '@/core/domain/pipeline';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { formatMoneyFromCents } from '@/lib/format';


interface KanbanMetricsStripProps {
  readonly summary: PipelineSummary;
  readonly isFiltered?: boolean;
}

export function KanbanMetricsStrip({ summary, isFiltered = false }: KanbanMetricsStripProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b border-line bg-surface-2/60 px-4 py-2 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display text-meta font-semibold text-muted tracking-tight uppercase">
            Resumo do Funil
          </span>
          {isFiltered && (
            <span className="rounded-full bg-blue-soft px-1.5 py-0.2 text-[10px] font-semibold text-blue-text">
              Filtros aplicados
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro font-medium text-dim transition-colors hover:bg-surface hover:text-ink"
        >
          <span>{collapsed ? 'Expandir resumo' : 'Recolher'}</span>
          {collapsed ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        </button>
      </div>

      {!collapsed && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Total de Oportunidades */}
          <div className="flex items-center gap-3 rounded-control border border-line bg-surface p-2.5 shadow-2xs transition-all hover:border-line">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-blue-soft text-blue-text">
              <Users className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-micro font-medium text-dim uppercase">Total no funil</p>
              <p className="font-display text-title font-bold text-ink tracking-tight tabular-nums">
                {summary.totalDeals}{' '}
                <span className="text-micro font-normal text-muted">
                  {summary.totalDeals === 1 ? 'oportunidade' : 'oportunidades'}
                </span>
              </p>
            </div>
          </div>

          {/* Card 2: Valor Total do Funil */}
          <div className="flex items-center gap-3 rounded-control border border-line bg-surface p-2.5 shadow-2xs transition-all hover:border-line">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
              <CircleDollarSign className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-micro font-medium text-dim uppercase">Valor Total</p>
              <p className="font-display text-title font-bold text-ink tracking-tight tabular-nums">
                {formatMoneyFromCents(summary.totalValueInCents)}
              </p>
            </div>
          </div>

          {/* Card 3: Em Negociação */}
          <div className="flex items-center gap-3 rounded-control border border-line bg-surface p-2.5 shadow-2xs transition-all hover:border-line">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-amber-soft text-amber-text">
              <TrendingUp className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-micro font-medium text-dim uppercase">Em Negociação</p>
              <p className="font-display text-title font-bold text-ink tracking-tight tabular-nums">
                {formatMoneyFromCents(summary.inNegotiationValueInCents)}{' '}
                <span className="text-micro font-normal text-muted">
                  ({summary.inNegotiationCount})
                </span>
              </p>
            </div>
          </div>

          {/* Card 4: Conversão ponderada */}
          <div className="flex items-center gap-3 rounded-control border border-line bg-surface p-2.5 shadow-2xs transition-all hover:border-line">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-cyan-soft text-cyan-text">
              <PieChart className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1 truncate text-micro font-medium text-dim uppercase">
                Conversão ponderada
                <InfoTooltip
                  label="conversão ponderada"
                  text="Média dos pesos das etapas em que os cards estão. Uma etapa com peso 50 faz cada card nela contribuir com 50%."
                />
              </p>
              <p className="font-display text-title font-bold text-ink tracking-tight tabular-nums">
                {summary.conversionRate}%
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
