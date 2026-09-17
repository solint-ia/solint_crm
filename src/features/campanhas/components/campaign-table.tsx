import Link from 'next/link';
import type { Route } from 'next';
import type { Campaign } from '@/core/domain/campaign';
import { CAMPAIGN_STATUS_LABELS, rate } from '@/core/domain/campaign';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { CAMPAIGN_STATUS_TONE } from '@/components/domain/presentation-maps';
import { formatNumber } from '@/lib/format';
import { CampaignActions } from './campaign-actions';

export function CampaignTable({
  campaigns,
  canDispatch,
}: {
  readonly campaigns: readonly Campaign[];
  readonly canDispatch: boolean;
}) {
  if (campaigns.length === 0) {
    return (
      <EmptyState
        title="Nenhuma campanha criada ainda"
        description="Uma campanha envia um template aprovado pela Meta a uma lista importada, a uma etiqueta ou à base inteira, por uma caixa da API oficial."
      />
    );
  }

  return (
    <Card padded={false} className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-body">
        <caption className="sr-only">Campanhas de disparo</caption>
        <thead className="border-b border-line text-meta tracking-wide text-dim uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">
              Campanha
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Destinatários
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Entregues
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Lidos
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Responderam
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Disparo
            </th>
            {canDispatch ? (
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Ações
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => {
            const m = campaign.metrics;
            return (
              <tr
                key={campaign.id}
                className="border-b border-line-soft last:border-0 hover:bg-surface-2/60"
              >
                <th scope="row" className="px-4 py-3 font-normal">
                  <Link
                    href={`/campanhas/${campaign.id}` as Route}
                    className="block font-semibold text-ink hover:underline"
                  >
                    {campaign.name}
                  </Link>
                  <span className="block text-meta text-dim">
                    {campaign.templateName} · {campaign.audienceLabel}
                  </span>
                  <span className="block text-meta text-dim">
                    {campaign.inboxName} · {campaign.inboxPhone}
                  </span>
                </th>
                <td className="px-4 py-3">
                  <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]} withDot>
                    {CAMPAIGN_STATUS_LABELS[campaign.status]}
                  </Badge>
                  {campaign.lastError ? (
                    <span className="mt-1 block max-w-[220px] truncate text-meta text-red-text">
                      {campaign.lastError}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-ink">
                  {formatNumber(m.sent + m.failed)}
                  <span className="text-dim"> / {formatNumber(m.recipients)}</span>
                  {m.failed > 0 ? (
                    <span className="block text-meta text-red-text">{m.failed} com falha</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-muted">
                  {m.sent > 0 ? `${rate(m.delivered, m.sent)}%` : '—'}
                </td>
                <td className="px-4 py-3 text-muted">
                  {m.delivered > 0 ? `${rate(m.read, m.delivered)}%` : '—'}
                </td>
                <td className="px-4 py-3 text-muted">
                  {m.sent > 0 ? `${rate(m.replied, m.sent)}%` : '—'}
                </td>
                <td className="px-4 py-3 text-muted">{campaign.scheduledLabel}</td>
                {canDispatch ? (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end">
                      <CampaignActions campaign={campaign} compact />
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
