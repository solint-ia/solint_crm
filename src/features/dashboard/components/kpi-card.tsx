import { TrendingDown, TrendingUp } from 'lucide-react';
import type { Kpi } from '@/core/domain/analytics';
import { cn } from '@/lib/cn';
import { Sparkline } from './sparkline';

/**
 * Indicador do período.
 *
 * Não é mais um card: cinco caixas idênticas lado a lado não criam hierarquia
 * nenhuma — o olho não tem onde pousar. Aqui a separação é um fio de 1px e a
 * ênfase vem do peso tipográfico, com a série logo abaixo do número.
 */
export function KpiCard({ kpi }: { readonly kpi: Kpi }) {
  const positive = kpi.deltaDirection === 'positivo';
  const neutral = kpi.deltaDirection === 'neutro';
  const toneVar = neutral
    ? 'var(--color-dim)'
    : positive
      ? 'var(--color-status-open)'
      : 'var(--color-status-danger)';

  return (
    <div className="flex flex-col gap-2 bg-surface px-4 py-3.5">
      <p className="text-meta font-medium tracking-tight text-muted">{kpi.label}</p>

      <p className="font-display text-display leading-none font-bold tracking-tight tabular-nums text-ink">
        {kpi.value}
      </p>

      <div className="flex items-end justify-between gap-3">
        <span
          className={cn(
            'inline-flex items-center gap-1 text-meta font-semibold tabular-nums',
            neutral && 'text-dim',
            positive && 'text-green-text',
            !positive && !neutral && 'text-red-text',
          )}
        >
          {positive ? (
            <TrendingUp className="size-3 shrink-0" />
          ) : !neutral ? (
            <TrendingDown className="size-3 shrink-0" />
          ) : null}
          {kpi.delta}
        </span>

        {kpi.series ? (
          <Sparkline points={kpi.series} colorVar={toneVar} className="w-20 shrink-0" />
        ) : null}
      </div>
    </div>
  );
}
