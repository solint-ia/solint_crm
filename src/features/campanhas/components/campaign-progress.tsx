import type { Campaign } from '@/core/domain/campaign';
import { rate } from '@/core/domain/campaign';
import { Card, CardHeader } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatNumber } from '@/lib/format';

/** Acompanhamento da campanha: quanto já saiu e como a Meta respondeu. */
export function CampaignProgress({ campaign }: { readonly campaign: Campaign }) {
  const { metrics } = campaign;
  const processados = metrics.sent + metrics.failed;
  const stats = [
    { label: 'Enviados', value: metrics.sent, tone: 'var(--color-brand)' },
    { label: 'Entregues', value: metrics.delivered, tone: 'var(--color-status-open)' },
    { label: 'Lidos', value: metrics.read, tone: 'var(--color-brand-cyan)' },
    { label: 'Responderam', value: metrics.replied, tone: 'var(--color-status-open)' },
    { label: 'Falhas', value: metrics.failed, tone: 'var(--color-status-danger)' },
  ];

  return (
    <Card>
      <CardHeader
        title={`Acompanhamento · ${campaign.name}`}
        description={`${formatNumber(processados)} de ${formatNumber(metrics.recipients)} destinatários processados · ${campaign.audienceLabel}`}
      />

      <ProgressBar
        className="mb-4"
        value={rate(processados, metrics.recipients)}
        label={`Progresso da campanha ${campaign.name}`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-control border border-line p-3">
            <p className="text-meta text-muted">{stat.label}</p>
            <p className="mt-0.5 font-display text-metric font-semibold text-ink">
              {formatNumber(stat.value)}
            </p>
            <ProgressBar
              className="mt-2"
              value={rate(stat.value, metrics.recipients)}
              label={`${stat.label} da campanha ${campaign.name}`}
              colorVar={stat.tone}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
