'use client';

import { useState } from 'react';
import {
  ArrowDownUp,
  Filter,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DEAL_SOURCES } from '@/core/domain/pipeline';
import { PRIORITIES } from '@/core/domain/conversation';
import { PRIORITY_LABEL } from '@/components/domain/presentation-maps';
import { cn } from '@/lib/cn';

export type SortOption =
  | 'recentes'
  | 'maior_valor'
  | 'menor_valor'
  | 'proxima_atividade';

export interface BoardFilters {
  readonly searchQuery: string;
  readonly owner: string | null;
  readonly team: string | null;
  readonly source: string | null;
  readonly period: string | null;
  readonly priority: string | null;
  readonly valueRange: string | null;
}

interface KanbanToolbarProps {
  readonly filters: BoardFilters;
  readonly sortOption: SortOption;
  readonly owners: readonly string[];
  readonly teams: readonly string[];
  readonly onFilterChange: <K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) => void;
  readonly onSortChange: (sort: SortOption) => void;
  readonly onClearFilters: () => void;
  readonly onOpenStagesModal: () => void;
  readonly onOpenNewDealModal: () => void;
}

export const PERIOD_OPTIONS = [
  { id: 'todos', label: 'Todos os períodos' },
  { id: 'hoje', label: 'Criados Hoje' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mês' },
  { id: 'trimestre', label: 'Este trimestre' },
] as const;

export const VALUE_RANGE_OPTIONS = [
  { id: 'todos', label: 'Todas as faixas' },
  { id: 'ate_5k', label: 'Até R$ 5.000' },
  { id: '5k_20k', label: 'R$ 5.000 a R$ 20.000' },
  { id: '20k_50k', label: 'R$ 20.000 a R$ 50.000' },
  { id: '50k_plus', label: 'Acima de R$ 50.000' },
] as const;

export function KanbanToolbar({
  filters,
  sortOption,
  owners,
  teams,
  onFilterChange,
  onSortChange,
  onClearFilters,
  onOpenStagesModal,
  onOpenNewDealModal,
}: KanbanToolbarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Contador de filtros ativos (excluindo busca)
  const activeFiltersCount = [
    filters.owner,
    filters.team,
    filters.source,
    filters.period && filters.period !== 'todos' ? filters.period : null,
    filters.priority,
    filters.valueRange && filters.valueRange !== 'todos' ? filters.valueRange : null,
  ].filter(Boolean).length;

  const hasActiveFilters = activeFiltersCount > 0 || Boolean(filters.searchQuery.trim());

  return (
    <div className="flex flex-col border-b border-line bg-surface px-4 py-2.5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Lado Esquerdo: Campo de Busca + Filtros Rápidos */}
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[260px]">
          {/* Busca no Funil */}
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
            <input
              type="text"
              placeholder="Filtrar por contato, título ou empresa..."
              value={filters.searchQuery}
              onChange={(e) => onFilterChange('searchQuery', e.target.value)}
              className="h-8.5 w-full rounded-control border border-line bg-surface-2 pr-7 pl-8 text-body text-ink placeholder:text-dim outline-none transition-colors focus:border-brand focus:bg-surface focus:ring-1 focus:ring-brand/20"
            />
            {filters.searchQuery && (
              <button
                type="button"
                onClick={() => onFilterChange('searchQuery', '')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-dim hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Filtro: Responsável */}
          <div className="hidden lg:block">
            <select
              aria-label="Filtrar por responsável"
              value={filters.owner ?? ''}
              onChange={(e) => onFilterChange('owner', e.target.value || null)}
              className={cn(
                'h-8.5 rounded-control border border-line bg-surface px-2.5 text-body text-ink outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand/20',
                filters.owner && 'border-brand bg-selected font-semibold text-brand',
              )}
            >
              <option value="">Responsável: Todos</option>
              {owners.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro: Origem */}
          <div className="hidden xl:block">
            <select
              aria-label="Filtrar por origem"
              value={filters.source ?? ''}
              onChange={(e) => onFilterChange('source', e.target.value || null)}
              className={cn(
                'h-8.5 rounded-control border border-line bg-surface px-2.5 text-body text-ink outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand/20',
                filters.source && 'border-brand bg-selected font-semibold text-brand',
              )}
            >
              <option value="">Origem: Todas</option>
              {DEAL_SOURCES.map((src) => (
                <option key={src.id} value={src.id}>
                  {src.label}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro: Prioridade */}
          <div className="hidden 2xl:block">
            <select
              aria-label="Filtrar por prioridade"
              value={filters.priority ?? ''}
              onChange={(e) => onFilterChange('priority', e.target.value || null)}
              className={cn(
                'h-8.5 rounded-control border border-line bg-surface px-2.5 text-body text-ink outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand/20',
                filters.priority && 'border-brand bg-selected font-semibold text-brand',
              )}
            >
              <option value="">Prioridade: Todas</option>
              {PRIORITIES.map((prio) => (
                <option key={prio} value={prio}>
                  {PRIORITY_LABEL[prio]}
                </option>
              ))}
            </select>
          </div>

          {/* Botão Gaveta / Popover de Filtros Avançados */}
          <Button
            variant={activeFiltersCount > 0 ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setDrawerOpen((v) => !v)}
            icon={<Filter className="size-3.5" />}
            className="relative"
          >
            <span>Filtros</span>
            {activeFiltersCount > 0 && (
              <span className="ml-1 flex size-4.5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-brand">
                {activeFiltersCount}
              </span>
            )}
          </Button>

          {/* Ordenação */}
          <div className="flex items-center gap-1.5">
            <ArrowDownUp className="size-3.5 text-dim hidden sm:block" />
            <select
              aria-label="Ordenar por"
              value={sortOption}
              onChange={(e) => onSortChange(e.target.value as SortOption)}
              className="h-8.5 rounded-control border border-line bg-surface px-2.5 text-body text-ink outline-none transition-colors focus:border-brand"
            >
              <option value="recentes">Mais recentes</option>
              <option value="maior_valor">Maior valor (R$)</option>
              <option value="menor_valor">Menor valor (R$)</option>
              <option value="proxima_atividade">Próxima atividade</option>
            </select>
          </div>
        </div>

        {/* Lado Direito: Ações (Configurar etapas + Nova oportunidade) */}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Settings2 className="size-3.5" />}
            onClick={onOpenStagesModal}
            title="Personalizar as etapas do funil"
          >
            <span className="hidden sm:inline">Configurar etapas</span>
          </Button>

          <button
            type="button"
            onClick={onOpenNewDealModal}
            className="inline-flex h-8.5 items-center justify-center gap-1.5 rounded-control bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-3.5 text-body font-semibold text-white shadow-sm shadow-blue-500/25 transition-all duration-150 hover:opacity-95 hover:shadow-md hover:shadow-blue-500/35 active:scale-[0.98]"
          >
            <Plus className="size-4 shrink-0 stroke-[2.5]" />
            <span>Nova oportunidade</span>
          </button>
        </div>
      </div>

      {/* Painel Expansível de Filtros Avançados */}
      {drawerOpen && (
        <div className="mt-3 rounded-control border border-line bg-surface-2 p-3.5 shadow-xs animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
            <span className="font-display text-body font-semibold text-ink flex items-center gap-1.5">
              <SlidersHorizontal className="size-3.5 text-brand" />
              Filtros Avançados do Funil
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="text-meta text-dim hover:text-ink"
            >
              Fechar
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Responsável */}
            <div>
              <label className="mb-1 block text-micro font-semibold uppercase text-dim">
                Responsável
              </label>
              <select
                value={filters.owner ?? ''}
                onChange={(e) => onFilterChange('owner', e.target.value || null)}
                className="w-full h-8.5 rounded-control border border-line bg-surface px-2 text-body text-ink outline-none focus:border-brand"
              >
                <option value="">Todos os vendedores</option>
                {owners.map((owner) => (
                  <option key={owner} value={owner}>
                    {owner}
                  </option>
                ))}
              </select>
            </div>

            {/* Equipe */}
            <div>
              <label className="mb-1 block text-micro font-semibold uppercase text-dim">
                Equipe
              </label>
              <select
                value={filters.team ?? ''}
                onChange={(e) => onFilterChange('team', e.target.value || null)}
                className="w-full h-8.5 rounded-control border border-line bg-surface px-2 text-body text-ink outline-none focus:border-brand"
              >
                <option value="">Todas as equipes</option>
                {teams.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
            </div>

            {/* Origem */}
            <div>
              <label className="mb-1 block text-micro font-semibold uppercase text-dim">
                Origem do Lead
              </label>
              <select
                value={filters.source ?? ''}
                onChange={(e) => onFilterChange('source', e.target.value || null)}
                className="w-full h-8.5 rounded-control border border-line bg-surface px-2 text-body text-ink outline-none focus:border-brand"
              >
                <option value="">Todas as origens</option>
                {DEAL_SOURCES.map((src) => (
                  <option key={src.id} value={src.id}>
                    {src.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Prioridade */}
            <div>
              <label className="mb-1 block text-micro font-semibold uppercase text-dim">
                Prioridade
              </label>
              <select
                value={filters.priority ?? ''}
                onChange={(e) => onFilterChange('priority', e.target.value || null)}
                className="w-full h-8.5 rounded-control border border-line bg-surface px-2 text-body text-ink outline-none focus:border-brand"
              >
                <option value="">Todas as prioridades</option>
                {PRIORITIES.map((prio) => (
                  <option key={prio} value={prio}>
                    {PRIORITY_LABEL[prio]}
                  </option>
                ))}
              </select>
            </div>

            {/* Período */}
            <div>
              <label className="mb-1 block text-micro font-semibold uppercase text-dim">
                Período de Entrada
              </label>
              <select
                value={filters.period ?? 'todos'}
                onChange={(e) => onFilterChange('period', e.target.value === 'todos' ? null : e.target.value)}
                className="w-full h-8.5 rounded-control border border-line bg-surface px-2 text-body text-ink outline-none focus:border-brand"
              >
                {PERIOD_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Faixa de Valor */}
            <div>
              <label className="mb-1 block text-micro font-semibold uppercase text-dim">
                Faixa de Valor (R$)
              </label>
              <select
                value={filters.valueRange ?? 'todos'}
                onChange={(e) =>
                  onFilterChange('valueRange', e.target.value === 'todos' ? null : e.target.value)
                }
                className="w-full h-8.5 rounded-control border border-line bg-surface px-2 text-body text-ink outline-none focus:border-brand"
              >
                {VALUE_RANGE_OPTIONS.map((vr) => (
                  <option key={vr.id} value={vr.id}>
                    {vr.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex justify-end gap-2 border-t border-line-soft pt-2.5">
            <Button variant="ghost" size="sm" onClick={onClearFilters}>
              Limpar todos
            </Button>
            <Button variant="primary" size="sm" onClick={() => setDrawerOpen(false)}>
              Aplicar filtros
            </Button>
          </div>
        </div>
      )}

      {/* Barra de Chips Removíveis dos Filtros Ativos */}
      {hasActiveFilters && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-line-soft">
          <span className="text-micro font-semibold text-dim uppercase">Filtros ativos:</span>

          {filters.searchQuery && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-line px-2 py-0.5 text-meta text-ink">
              <span>Busca: &ldquo;{filters.searchQuery}&rdquo;</span>
              <button
                type="button"
                onClick={() => onFilterChange('searchQuery', '')}
                className="rounded-full p-0.5 hover:bg-surface text-dim hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </span>
          )}

          {filters.owner && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-soft border border-blue-soft text-blue-text px-2 py-0.5 text-meta font-medium">
              <span>Vendedor: {filters.owner}</span>
              <button
                type="button"
                onClick={() => onFilterChange('owner', null)}
                className="rounded-full p-0.5 hover:bg-blue-200/50 text-blue-text"
              >
                <X className="size-3" />
              </button>
            </span>
          )}

          {filters.team && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-line px-2 py-0.5 text-meta text-ink">
              <span>Equipe: {filters.team}</span>
              <button
                type="button"
                onClick={() => onFilterChange('team', null)}
                className="rounded-full p-0.5 hover:bg-surface text-dim hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </span>
          )}

          {filters.source && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-soft border border-emerald-soft text-emerald-text px-2 py-0.5 text-meta font-medium">
              <span>
                Origem: {DEAL_SOURCES.find((s) => s.id === filters.source)?.label ?? filters.source}
              </span>
              <button
                type="button"
                onClick={() => onFilterChange('source', null)}
                className="rounded-full p-0.5 hover:bg-emerald-200/50 text-emerald-text"
              >
                <X className="size-3" />
              </button>
            </span>
          )}

          {filters.priority && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft border border-amber-soft text-amber-text px-2 py-0.5 text-meta font-medium">
              <span>Prioridade: {PRIORITY_LABEL[filters.priority as keyof typeof PRIORITY_LABEL] ?? filters.priority}</span>
              <button
                type="button"
                onClick={() => onFilterChange('priority', null)}
                className="rounded-full p-0.5 hover:bg-amber-200/50 text-amber-text"
              >
                <X className="size-3" />
              </button>
            </span>
          )}

          {filters.period && filters.period !== 'todos' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-soft border border-purple-soft text-purple-text px-2 py-0.5 text-meta font-medium">
              <span>Período: {PERIOD_OPTIONS.find((p) => p.id === filters.period)?.label ?? filters.period}</span>
              <button
                type="button"
                onClick={() => onFilterChange('period', null)}
                className="rounded-full p-0.5 hover:bg-purple-200/50 text-purple-text"
              >
                <X className="size-3" />
              </button>
            </span>
          )}

          {filters.valueRange && filters.valueRange !== 'todos' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-soft border border-cyan-soft text-cyan-text px-2 py-0.5 text-meta font-medium">
              <span>Faixa: {VALUE_RANGE_OPTIONS.find((vr) => vr.id === filters.valueRange)?.label ?? filters.valueRange}</span>
              <button
                type="button"
                onClick={() => onFilterChange('valueRange', null)}
                className="rounded-full p-0.5 hover:bg-cyan-200/50 text-cyan-text"
              >
                <X className="size-3" />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={onClearFilters}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-meta font-semibold text-brand hover:underline"
          >
            <RotateCcw className="size-3" />
            Limpar todos
          </button>
        </div>
      )}
    </div>
  );
}
