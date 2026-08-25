import Link from 'next/link';
import { ArrowUpRight, Kanban } from 'lucide-react';

import type { FunnelStageSummary } from '@/core/domain/analytics';
import { formatMoneyFromCents } from '@/lib/format';

interface FunnelSummaryCardProps {
  readonly stages: readonly FunnelStageSummary[];
}

export function FunnelSummaryCard({ stages }: FunnelSummaryCardProps) {
  const totalValueInCents = stages.reduce((acc, stage) => acc + stage.amountInCents, 0);
  const totalDeals = stages.reduce((acc, stage) => acc + stage.count, 0);

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <div>
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Kanban className="size-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold text-ink">Funil de oportunidades</h2>
              <p className="text-[11px] text-muted">Pipeline comercial em andamento</p>
            </div>
          </div>

          <Link
            href="/kanban"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand transition-colors hover:text-brand/80"
          >
            Ver Kanban
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>

        {/* Resumo Total */}
        <div className="my-3.5 flex items-center justify-between rounded-xl bg-surface-2/60 p-3">
          <div>
            <span className="text-[11px] font-medium text-muted">Pipeline ativo</span>
            <p className="font-display text-base font-bold text-ink tabular-nums">
              {formatMoneyFromCents(totalValueInCents)}
            </p>
          </div>
          <div className="text-right">
            <span className="text-[11px] font-medium text-muted">Total de negócios</span>
            <p className="font-display text-base font-bold text-brand tabular-nums">
              {totalDeals} oportunidades
            </p>
          </div>
        </div>

        {/* Estágios do Funil */}
        <ul className="flex flex-col gap-2.5">
          {stages.map((stage) => (
            <li key={stage.stage}>
              <Link
                href="/kanban"
                className="group flex items-center justify-between gap-2 rounded-xl p-1.5 transition-colors hover:bg-surface-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full shadow-2xs"
                    style={{ backgroundColor: stage.colorVar }}
                  />
                  <span className="truncate text-xs font-medium text-ink group-hover:text-brand">
                    {stage.stage}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-3 tabular-nums">
                  <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                    {stage.count}
                  </span>
                  <span className="w-24 text-right font-mono text-xs font-bold text-ink">
                    {formatMoneyFromCents(stage.amountInCents)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 border-t border-line pt-2.5 text-center">
        <Link
          href="/kanban"
          className="text-[11px] font-semibold text-muted transition-colors hover:text-brand"
        >
          Gerenciar negociações e etapas no Funil Comercial →
        </Link>
      </div>
    </div>
  );
}
