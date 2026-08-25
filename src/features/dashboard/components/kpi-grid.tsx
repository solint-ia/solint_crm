import type { Kpi } from '@/core/domain/analytics';
import { KpiCard } from './kpi-card';

interface KpiGridProps {
  readonly kpis: readonly Kpi[];
}

export function KpiGrid({ kpis }: KpiGridProps) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.id} kpi={kpi} />
      ))}
    </div>
  );
}
