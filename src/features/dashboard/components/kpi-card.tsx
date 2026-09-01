import {
  Activity,
  CheckCircle2,
  Clock,
  MessageSquare,
  Minus,
  Star,
  TrendingDown,
  TrendingUp,
  UserX,
} from 'lucide-react';
import type { Kpi } from '@/core/domain/analytics';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/cn';

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

/**
 * Um indicador do painel.
 *
 * **O mini-gráfico saiu.** Ele desenhava uma série de cinco pontos que o
 * servidor fabricava a partir do próprio valor atual (`[valor - 2, valor + 1,
 * valor - 1, valor, valor]`) — uma forma inventada, com aparência de histórico,
 * ao lado de um número verdadeiro. Uma tendência falsa é pior que nenhuma
 * tendência: ela é lida como informação. O espaço que ele ocupava foi para o
 * número, que agora respira, e para a variação, que é a comparação real com o
 * período anterior.
 */
export function KpiCard({ kpi }: KpiCardProps) {
  const Icon = KPI_ICONS[kpi.id] || Activity;
  const positive = kpi.deltaDirection === 'positivo';
  const negative = kpi.deltaDirection === 'negativo';

  // Fila parada é aviso, não desempenho: estes dois se pintam pelo próprio
  // valor, porque "5 conversas sem dono" é ruim independentemente da variação.
  const alerta = kpi.id === 'sem-responsavel' && Number.parseInt(kpi.value, 10) > 0;
  const atencao = kpi.id === 'nao-lidas' && Number.parseInt(kpi.value, 10) > 0;

  const DeltaIcon = positive ? TrendingUp : negative ? TrendingDown : Minus;

  return (
    <div
      className={cn(
        'group relative flex flex-col justify-between gap-4 rounded-2xl border bg-surface p-4 shadow-2xs transition-all hover:shadow-xs',
        alerta
          ? 'border-amber-500/35 hover:border-amber-500/60'
          : atencao
            ? 'border-blue-500/30 hover:border-blue-500/50'
            : 'border-line hover:border-brand/40',
      )}
    >
      {/* Faixa de cor à esquerda — o estado do cartão lido antes do número. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-0.5 rounded-l-2xl',
          alerta ? 'bg-amber-500' : atencao ? 'bg-blue-500' : 'bg-transparent',
        )}
      />

      <div className="flex items-start gap-2">
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors',
            alerta
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : atencao
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'bg-surface-2 text-muted group-hover:text-brand',
          )}
        >
          <Icon className="size-4" />
        </div>

        <div className="flex min-w-0 flex-1 items-start gap-1">
          <span className="text-xs leading-snug font-semibold text-muted">{kpi.label}</span>
          <InfoTooltip text={kpi.description} label={kpi.label} className="mt-px shrink-0" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-display text-3xl leading-none font-bold tracking-tight text-ink tabular-nums">
          {kpi.value}
        </span>

        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 text-[11px] font-semibold tabular-nums',
            alerta
              ? 'text-amber-600 dark:text-amber-400'
              : positive
                ? 'text-green-700 dark:text-green-400'
                : negative
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-dim',
          )}
        >
          <DeltaIcon className="size-3 shrink-0" />
          {kpi.delta}
        </span>
      </div>
    </div>
  );
}
