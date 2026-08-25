'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { Calendar } from 'lucide-react';
import type { PeriodKey } from '@/core/domain/analytics';
import { cn } from '@/lib/cn';

const PERIODS: readonly { id: PeriodKey; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'mes', label: 'Este mês' },
];

interface PeriodSelectorProps {
  readonly basePath: string;
  readonly current: PeriodKey;
  readonly extraParams?: Readonly<Record<string, string>>;
}

/**
 * Seletor de período via URL: o servidor refaz a consulta,
 * o estado fica compartilhável e o botão voltar funciona nativamente.
 */
export function PeriodSelector({ basePath, current, extraParams }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-2xs">
      <div className="flex items-center pl-2 pr-1 text-muted" title="Período de análise">
        <Calendar className="size-3.5" />
      </div>
      {PERIODS.map((period) => {
        const params = new URLSearchParams({ ...extraParams, periodo: period.id });
        const active = period.id === current;
        return (
          <Link
            key={period.id}
            href={`${basePath}?${params.toString()}` as Route}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'rounded-lg px-3 py-1 text-xs font-semibold transition-all',
              active
                ? 'bg-brand text-white shadow-xs font-bold'
                : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            {period.label}
          </Link>
        );
      })}
    </div>
  );
}
