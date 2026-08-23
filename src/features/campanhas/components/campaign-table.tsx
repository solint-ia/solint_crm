import type { Campaign } from '@/core/domain/campaign';
import { CAMPAIGN_STATUS_LABELS, rate } from '@/core/domain/campaign';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { CAMPAIGN_STATUS_TONE } from '@/components/domain/presentation-maps';

export function CampaignTable({ campaigns }: { readonly campaigns: readonly Campaign[] }) {
  if (campaigns.length === 0) {
    return (
      <EmptyState
        title="Nenhuma campanha criada ainda"
        description="Crie uma campanha para enviar um template aprovado a um segmento de contatos."
      />
    );
  }

  return (
    <Card padded={false} className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-body">
        <caption className="sr-only">Campanhas de disparo em massa</caption>
        <thead className="border-b border-line text-meta tracking-wide text-dim uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Campanha</th>
            <th scope="col" className="px-4 py-3 font-semibold">Status</th>
            <th scope="col" className="px-4 py-3 font-semibold">Entrega</th>
            <th scope="col" className="px-4 py-3 font-semibold">Leitura</th>
            <th scope="col" className="px-4 py-3 font-semibold">Envio</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="border-b border-line-soft last:border-0">
              <th scope="row" className="px-4 py-3 font-normal">
                <span className="block font-semibold text-ink">{campaign.name}</span>
                <span className="block text-meta text-dim">{campaign.segmentName}</span>
              </th>
              <td className="px-4 py-3">
                <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]} withDot>
                  {CAMPAIGN_STATUS_LABELS[campaign.status]}
                </Badge>
              </td>
              <td className="px-4 py-3 text-muted">
                {campaign.metrics.sent > 0
                  ? `${rate(campaign.metrics.delivered, campaign.metrics.sent)}%`
                  : '—'}
              </td>
              <td className="px-4 py-3 text-muted">
                {campaign.metrics.delivered > 0
                  ? `${rate(campaign.metrics.read, campaign.metrics.delivered)}%`
                  : '—'}
              </td>
              <td className="px-4 py-3 text-muted">{campaign.scheduledLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
