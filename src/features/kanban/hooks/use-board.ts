'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import type { Deal, PipelineStage } from '@/core/domain/pipeline';
import { isDealStale, sumDeals } from '@/core/domain/pipeline';

interface UseBoardParams {
  readonly initialDeals: readonly Deal[];
  readonly stages: readonly PipelineStage[];
  readonly moveDeal: (input: {
    dealId: string;
    targetStageId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

/** Estado do board: agrupamento por etapa, drag-and-drop e persistencia. */
export function useBoard({ initialDeals, stages, moveDeal }: UseBoardParams) {
  const [deals, setDeals] = useState<readonly Deal[]>(initialDeals);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  const visibleDeals = useMemo(
    () => (ownerFilter ? deals.filter((deal) => deal.ownerName === ownerFilter) : deals),
    [deals, ownerFilter],
  );

  const columns = useMemo(
    () =>
      stages.map((stage) => {
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

  const openDeal = useMemo(
    () => deals.find((deal) => deal.id === openDealId) ?? null,
    [deals, openDealId],
  );

  const owners = useMemo(
    () => Array.from(new Set(deals.map((deal) => deal.ownerName))).sort(),
    [deals],
  );

  const drop = useCallback(
    (targetStageId: string) => {
      const dealId = draggingId;
      setDraggingId(null);
      setDragOverStageId(null);
      if (!dealId) return;

      const current = deals.find((deal) => deal.id === dealId);
      if (!current || current.stageId === targetStageId) return;

      setDeals((items) =>
        items.map((deal) =>
          deal.id === dealId ? { ...deal, stageId: targetStageId, stageAgeLabel: 'agora' } : deal,
        ),
      );
      setError(undefined);

      startTransition(async () => {
        const result = await moveDeal({ dealId, targetStageId });
        if (!result.ok) {
          setError(result.error);
          setDeals((items) => items.map((deal) => (deal.id === dealId ? current : deal)));
        }
      });
    },
    [draggingId, deals, moveDeal],
  );

  return {
    columns,
    owners,
    openDeal,
    draggingId,
    dragOverStageId,
    ownerFilter,
    error,
    isStale: isDealStale,
    setOwnerFilter,
    setDraggingId,
    setDragOverStageId,
    setOpenDealId,
    drop,
  };
}
