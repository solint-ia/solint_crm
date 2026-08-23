import Link from 'next/link';
import type { Route } from 'next';
import { cn } from '@/lib/cn';

export const REPORT_TABS = ['conversas', 'comparativo', 'agentes', 'funil', 'csat'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

const LABELS: Readonly<Record<ReportTab, string>> = {
  conversas: 'Conversas',
  comparativo: 'Comparativo',
  agentes: 'Agentes',
  funil: 'Funil',
  csat: 'CSAT',
};

export function ReportTabs({
  current,
  period,
}: {
  readonly current: ReportTab;
  readonly period: string;
}) {
  return (
    <nav aria-label="Seções do relatório" className="inline-flex flex-wrap gap-1 rounded-control bg-surface-2 p-1">
      {REPORT_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/relatorios?aba=${tab}&periodo=${period}` as Route}
          aria-current={tab === current ? 'true' : undefined}
          className={cn(
            'rounded-control px-3 py-1.5 text-body font-semibold transition-colors',
            tab === current ? 'bg-surface text-brand shadow-xs' : 'text-muted hover:text-ink',
          )}
        >
          {LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
