import type { ConversionRate, LossReason } from '@/core/domain/analytics';
import { Section } from '@/components/ui/section';
import { ProgressBar } from '@/components/ui/progress-bar';

interface FunnelReportProps {
  readonly conversions: readonly ConversionRate[];
  readonly lossReasons: readonly LossReason[];
}

export function FunnelReport({ conversions, lossReasons }: FunnelReportProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Conversão por etapa">
        <ul className="flex flex-col gap-3">
          {conversions.map((conversion) => (
            <li key={conversion.stage}>
              <div className="mb-1 flex items-center justify-between text-body">
                <span className="text-ink">{conversion.stage}</span>
                <span className="font-semibold text-brand">{conversion.rate}</span>
              </div>
              <ProgressBar
                value={Number.parseInt(conversion.rate, 10)}
                label={`Conversão ${conversion.stage}`}
              />
              <p className="mt-1 text-meta text-dim">{conversion.average}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Motivos de perda" className="lg:border-l lg:border-line lg:pl-6">
        <ul className="flex flex-col gap-3">
          {lossReasons.map((reason) => (
            <li key={reason.reason}>
              <div className="mb-1 flex items-center justify-between text-body">
                <span className="text-ink">{reason.reason}</span>
                <span className="text-muted">{reason.percentage}%</span>
              </div>
              <ProgressBar
                value={reason.percentage}
                label={`Perdas por ${reason.reason}`}
                colorVar="var(--color-status-danger)"
              />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
