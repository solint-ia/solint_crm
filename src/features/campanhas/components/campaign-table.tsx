'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Pause, Play, Trash2 } from 'lucide-react';
import type { Campaign } from '@/core/domain/campaign';
import { CAMPAIGN_STATUS_LABELS, rate } from '@/core/domain/campaign';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { CAMPAIGN_STATUS_TONE } from '@/components/domain/presentation-maps';
import {
  deleteCampaignAction,
  toggleCampaignStatusAction,
} from '@/app/(workspace)/campanhas/actions';

export function CampaignTable({ campaigns }: { readonly campaigns: readonly Campaign[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deletingCampaign, setDeletingCampaign] = useState<Campaign | null>(null);

  const handleToggleStatus = (campaign: Campaign) => {
    const nextStatus = campaign.status === 'em_andamento' ? 'pausada' : 'em_andamento';
    startTransition(async () => {
      await toggleCampaignStatusAction({ campaignId: campaign.id, status: nextStatus });
      router.refresh();
    });
  };

  const handleConfirmDelete = async () => {
    if (!deletingCampaign) return;
    startTransition(async () => {
      await deleteCampaignAction({ campaignId: deletingCampaign.id });
      setDeletingCampaign(null);
      router.refresh();
    });
  };


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
            <th scope="col" className="px-4 py-3 font-semibold text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="border-b border-line-soft last:border-0 hover:bg-surface-2/60">
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
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  {campaign.status === 'em_andamento' || campaign.status === 'pausada' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleToggleStatus(campaign)}
                      icon={
                        campaign.status === 'em_andamento' ? (
                          <Pause className="size-3.5" />
                        ) : (
                          <Play className="size-3.5" />
                        )
                      }
                    />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    aria-label={`Excluir campanha ${campaign.name}`}
                    onClick={() => setDeletingCampaign(campaign)}
                    icon={<Trash2 className="size-3.5 text-danger" />}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmModal
        open={deletingCampaign !== null}
        title="Excluir campanha"
        description={
          <span>
            Tem certeza que deseja excluir a campanha{' '}
            <strong className="text-ink">{deletingCampaign?.name}</strong>? Os relatórios e métricas de envio desta campanha serão removidos permanentemente.
          </span>
        }
        confirmLabel="Excluir campanha"
        variant="danger"
        isLoading={isPending}
        onClose={() => setDeletingCampaign(null)}
        onConfirm={handleConfirmDelete}
      />
    </Card>
  );
}


