import type { Campaign } from '@/core/domain/campaign';
import { rate } from '@/core/domain/campaign';
import { Card, CardHeader } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatNumber } from '@/lib/format';

/** Acompanhamento em tempo real da campanha em andamento. */
export function CampaignProgress({ campaign }: { readonly campaign: Campaign }) {
  const { metrics } = campaign;
  const stats = [
    { label: 'Enviados', value: metrics.sent, tone: 'var(--color-brand)' },
    { label: 'Entregues', value: metrics.delivered, tone: 'var(--color-status-open)' },
    { label: 'Lidos', value: metrics.read, tone: 'var(--color-brand-cyan)' },
    { label: 'Erros', value: metrics.failed, tone: 'var(--color-status-danger)' },
  ];

  return (
    <Card>
      <CardHeader
        title={`Acompanhamento · ${campaign.name}`}
        description={`${formatNumber(metrics.recipients)} destinatários no segmento ${campaign.segmentName}`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
