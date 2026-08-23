import type { FunnelStageSummary } from '@/core/domain/analytics';
import { formatMoneyFromCents } from '@/lib/format';

export function FunnelSummary({ stages }: { readonly stages: readonly FunnelStageSummary[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {stages.map((stage) => (
        <li key={stage.stage} className="flex items-center gap-2.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: stage.colorVar }} />
          <span className="flex-1 text-body text-ink">{stage.stage}</span>
          <span className="text-meta text-dim">{stage.count}</span>
          <span className="w-24 text-right font-mono text-meta text-muted">
            {formatMoneyFromCents(stage.amountInCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}
