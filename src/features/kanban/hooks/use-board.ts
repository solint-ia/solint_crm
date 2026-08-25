'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { Deal, PipelineStage, PipelineSummary } from '@/core/domain/pipeline';
import {
  calculatePipelineSummary,
  isDealStale,
  sumDeals,
} from '@/core/domain/pipeline';
import type { BoardFilters, SortOption } from '../components/kanban-toolbar';

interface UseBoardParams {
  readonly initialDeals: readonly Deal[];
  readonly stages: readonly PipelineStage[];
  readonly moveDeal: (input: {
    dealId: string;
    targetStageId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

const INITIAL_FILTERS: BoardFilters = {
  searchQuery: '',
  owner: null,
  team: null,
  source: null,
  period: null,
  priority: null,
  valueRange: null,
};

export function useBoard({ initialDeals, stages: initialStages, moveDeal }: UseBoardParams) {
  const [deals, setDeals] = useState<readonly Deal[]>(initialDeals);
  const [stages, setStages] = useState<readonly PipelineStage[]>(initialStages);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [newDealModalOpen, setNewDealModalOpen] = useState(false);
  const [newDealStageId, setNewDealStageId] = useState<string | undefined>(undefined);
  const [stagesModalOpen, setStagesModalOpen] = useState(false);
  const [filters, setFilters] = useState<BoardFilters>(INITIAL_FILTERS);
  const [sortOption, setSortOption] = useState<SortOption>('recentes');
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  // Sincronizar com props iniciais do servidor
  useEffect(() => {
    setDeals(initialDeals);
  }, [initialDeals]);

  useEffect(() => {
    setStages(initialStages);
  }, [initialStages]);


  // Atualizar filtro específico
  const setFilter = useCallback(<K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, []);

  // Lista de vendedores únicos
  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) {
      if (d.ownerName && d.ownerName !== 'Não atribuído') set.add(d.ownerName);
    }
    return Array.from(set).sort();
  }, [deals]);

  // Lista de equipes únicas
  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) {
      if (d.team) set.add(d.team);
    }
    return Array.from(set).sort();
  }, [deals]);

  // Filtragem
  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      // 1. Busca por texto
      if (filters.searchQuery.trim()) {
        const query = filters.searchQuery.toLowerCase().trim();
        const matchTitle = (deal.title ?? '').toLowerCase().includes(query);
        const matchContact = deal.contactName.toLowerCase().includes(query);
        const matchCompany = (deal.company ?? '').toLowerCase().includes(query);
        const matchAction = deal.nextAction.toLowerCase().includes(query);
        if (!matchTitle && !matchContact && !matchCompany && !matchAction) return false;
      }

      // 2. Filtro de Responsável
      if (filters.owner && deal.ownerName !== filters.owner) return false;

      // 3. Filtro de Equipe
      if (filters.team && deal.team !== filters.team) return false;

      // 4. Filtro de Origem
      if (filters.source && deal.source !== filters.source) return false;

      // 5. Filtro de Prioridade
      if (filters.priority && deal.priority !== filters.priority) return false;

      // 6. Faixa de Valor
      if (filters.valueRange && filters.valueRange !== 'todos') {
        const val = deal.amountInCents;
        if (filters.valueRange === 'ate_5k' && val > 500_000) return false;
        if (filters.valueRange === '5k_20k' && (val < 500_000 || val > 2_000_000)) return false;
        if (filters.valueRange === '20k_50k' && (val < 2_000_000 || val > 5_000_000)) return false;
        if (filters.valueRange === '50k_plus' && val < 5_000_000) return false;
      }

      return true;
    });
  }, [deals, filters]);

  // Ordenação
  const visibleDeals = useMemo(() => {
    const list = [...filteredDeals];
    switch (sortOption) {
      case 'maior_valor':
        return list.sort((a, b) => b.amountInCents - a.amountInCents);
      case 'menor_valor':
        return list.sort((a, b) => a.amountInCents - b.amountInCents);
      case 'probabilidade':
        return list.sort((a, b) => (b.probability ?? 50) - (a.probability ?? 50));
      case 'proxima_atividade':
        return list.sort((a, b) => a.nextAction.localeCompare(b.nextAction));
      case 'recentes':
      default:
        return list.sort(
          (a, b) => new Date(b.enteredStageAt).getTime() - new Date(a.enteredStageAt).getTime(),
        );
    }
  }, [filteredDeals, sortOption]);

  // Colunas do Kanban
  const columns = useMemo(
    () =>
      stages
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((stage) => {
          const stageDeals = visibleDeals.filter((deal) => deal.stageId === stage.id);
          return {
            stage,
            deals: stageDeals,
            count: stageDeals.length,
            total: sumDeals(stageDeals),
          };
        }),
    [stages, visibleDeals],
  );

  // Resumo de KPIs do Funil
  const summary: PipelineSummary = useMemo(
    () => calculatePipelineSummary(visibleDeals, stages),
    [visibleDeals, stages],
  );

  const openDeal = useMemo(
    () => deals.find((deal) => deal.id === openDealId) ?? null,
    [deals, openDealId],
  );

  // Drag and drop handler com feedback otimista e notificação
  const drop = useCallback(
    (targetStageId: string) => {
      const dealId = draggingId;
      setDraggingId(null);
      setDragOverStageId(null);
      if (!dealId) return;

      const current = deals.find((deal) => deal.id === dealId);
      if (!current || current.stageId === targetStageId) return;

      const targetStage = stages.find((s) => s.id === targetStageId);
      const targetStageName = targetStage?.name ?? 'nova etapa';

      // Atualização otimista imediata
      setDeals((items) =>
        items.map((deal) =>
          deal.id === dealId
            ? {
                ...deal,
                stageId: targetStageId,
                stageAgeLabel: 'agora',
                probability: targetStage?.defaultProbability ?? deal.probability,
                history: [
                  ...deal.history,
                  {
                    text: `Movido para ${targetStageName}`,
                    date: 'Hoje, agora',
                  },
                ],
              }
            : deal,
        ),
      );

      setError(undefined);
      setNotification(`Oportunidade movida para ${targetStageName}`);

      // Limpar toast de notificação após 4 segundos
      setTimeout(() => setNotification(null), 4000);

      startTransition(async () => {
        const result = await moveDeal({ dealId, targetStageId });
        if (!result.ok) {
          setError(result.error);
          setDeals((items) => items.map((deal) => (deal.id === dealId ? current : deal)));
          setNotification(null);
        }
      });
    },
    [draggingId, deals, stages, moveDeal],
  );

  // Criar nova oportunidade localmente + otimista
  const handleOptimisticCreate = useCallback(
    (newDeal: Deal) => {
      setDeals((prev) => [newDeal, ...prev]);
    },
    [],
  );

  // Atualizar oportunidade localmente
  const handleOptimisticUpdate = useCallback(
    (updated: Deal) => {
      setDeals((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    },
    [],
  );

  // Excluir oportunidade localmente
  const handleOptimisticDelete = useCallback(
    (dealId: string) => {
      setDeals((prev) => prev.filter((d) => d.id !== dealId));
      if (openDealId === dealId) setOpenDealId(null);
      if (editingDeal?.id === dealId) setEditingDeal(null);
    },
    [openDealId, editingDeal],
  );

  return {
    deals,
    visibleDeals,
    stages,
    columns,
    summary,
    owners,
    teams,
    filters,
    sortOption,
    draggingId,
    dragOverStageId,
    openDeal,
    editingDeal,
    newDealModalOpen,
    newDealStageId,
    stagesModalOpen,
    notification,
    error,
    isStale: isDealStale,
    setFilter,
    setSortOption,
    clearAllFilters,
    setDraggingId,
    setDragOverStageId,
    setOpenDealId,
    setEditingDeal,
    setNewDealModalOpen,
    setNewDealStageId,
    setStagesModalOpen,
    setStages,
    drop,
    handleOptimisticCreate,
    handleOptimisticUpdate,
    handleOptimisticDelete,
  };
}
