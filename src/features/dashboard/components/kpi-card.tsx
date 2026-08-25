import {
  Activity,
  CheckCircle2,
  Clock,
  HelpCircle,
  MessageSquare,
  Star,
  TrendingDown,
  TrendingUp,
  UserX,
} from 'lucide-react';
import type { Kpi } from '@/core/domain/analytics';
import { cn } from '@/lib/cn';
import { Sparkline } from './sparkline';

interface KpiCardProps {
  readonly kpi: Kpi;
}

const KPI_ICONS: Record<string, React.ElementType> = {
  abertas: MessageSquare,
  'sem-responsavel': UserX,
  'nao-lidas': Activity,
  tpr: Clock,
  tmr: CheckCircle2,
  csat: Star,
};

export function KpiCard({ kpi }: KpiCardProps) {
  const Icon = KPI_ICONS[kpi.id] || Activity;
  const positive = kpi.deltaDirection === 'positivo';
  const neutral = kpi.deltaDirection === 'neutro';

  // Configuração sutil de cores para cada KPI
  const isAlert = kpi.id === 'sem-responsavel' && parseInt(kpi.value, 10) > 0;
  const isUnread = kpi.id === 'nao-lidas' && parseInt(kpi.value, 10) > 0;

  const toneVar = isAlert
    ? 'var(--color-brand-amber)'
    : isUnread
      ? 'var(--color-blue-text)'
      : positive
        ? 'var(--color-brand)'
        : 'var(--color-dim)';

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-2xs transition-all hover:border-brand/40 hover:shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors',
              isAlert
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : isUnread
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'bg-surface-2 text-muted group-hover:text-brand',
            )}
          >
            <Icon className="size-4" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted">{kpi.label}</span>
            {kpi.description ? (
              <span title={kpi.description} className="cursor-help text-dim hover:text-muted">
                <HelpCircle className="size-3" />
              </span>
            ) : null}
          </div>
        </div>

        {kpi.series && kpi.series.length > 0 ? (
          <div className="w-16 shrink-0 opacity-80 transition-opacity group-hover:opacity-100">
            <Sparkline points={kpi.series} colorVar={toneVar} className="h-6 w-full" />
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <span className="font-display text-2xl font-bold tracking-tight text-ink tabular-nums sm:text-3xl">
          {kpi.value}
        </span>

        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold tabular-nums',
            isAlert
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : isUnread
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : positive
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : neutral
                    ? 'bg-surface-2 text-muted'
                    : 'bg-red-500/10 text-red-700 dark:text-red-400',
          )}
        >
          {positive && !isAlert ? (
            <TrendingUp className="size-3" />
          ) : !positive && !neutral && !isUnread ? (
            <TrendingDown className="size-3" />
          ) : null}
          {kpi.delta}
        </span>
      </div>
    </div>
  );
}
