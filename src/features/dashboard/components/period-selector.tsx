import Link from 'next/link';
import type { Route } from 'next';
import type { PeriodKey } from '@/core/domain/analytics';
import { cn } from '@/lib/cn';

const PERIODS: readonly { id: PeriodKey; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
];

interface PeriodSelectorProps {
  readonly basePath: string;
  readonly current: PeriodKey;
  readonly extraParams?: Readonly<Record<string, string>>;
}

/**
 * Seletor de período via URL: o servidor refaz a consulta,
 * o estado fica compartilhavel e o botao voltar funciona.
 */
export function PeriodSelector({ basePath, current, extraParams }: PeriodSelectorProps) {
  return (
    <div className="inline-flex gap-1 rounded-control bg-surface-2 p-1">
      {PERIODS.map((period) => {
        // A chave da URL e' `periodo` sem acento — e' o que a pagina le.
        const params = new URLSearchParams({ ...extraParams, periodo: period.id });
        const active = period.id === current;
        return (
          <Link
            key={period.id}
            href={`${basePath}?${params.toString()}` as Route}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'rounded-control px-3 py-1.5 text-body font-semibold transition-colors',
              active ? 'bg-surface text-brand shadow-xs' : 'text-muted hover:text-ink',
            )}
          >
            {period.label}
          </Link>
        );
      })}
    </div>
  );
}
