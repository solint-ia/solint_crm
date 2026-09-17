'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Ban, Pause, Play, Trash2 } from 'lucide-react';
import type { Campaign } from '@/core/domain/campaign';
import { canCancelCampaign, canPauseCampaign, canResumeCampaign } from '@/core/domain/campaign';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useToast } from '@/components/ui/toast';
import {
  cancelCampaignAction,
  deleteCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
} from '@/app/(workspace)/campanhas/actions';

/**
 * Pausar, retomar, cancelar e excluir, com as regras do domínio decidindo o
 * que aparece. Cancelar e excluir pedem confirmação: o primeiro para de
 * mandar para quem ainda não recebeu, o segundo apaga o relatório.
 */
export function CampaignActions({
  campaign,
  afterDelete,
  compact = false,
}: {
  readonly campaign: Campaign;
  /** Para onde ir depois de excluir. Ausente, só recarrega. */
  readonly afterDelete?: Route;
  readonly compact?: boolean;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState<'cancelar' | 'excluir' | null>(null);

  const rodar = (acao: () => Promise<{ ok: boolean; error?: string }>, sucesso: string) =>
    startTransition(async () => {
      const result = await acao();
      if (!result.ok) {
        show({ tone: 'erro', title: 'Não foi possível', description: result.error ?? '' });
        return;
      }
      show({ tone: 'sucesso', title: sucesso });
      setConfirmando(null);
      router.refresh();
    });

  const size = compact ? 'sm' : 'md';
  const variant = compact ? 'ghost' : 'secondary';
  const rotulo = (texto: string) => (compact ? undefined : texto);

  return (
    <div className="flex items-center gap-1">
      {canPauseCampaign(campaign.status) ? (
        <Button
          variant={variant}
          size={size}
          disabled={isPending}
          aria-label="Pausar campanha"
          icon={<Pause className="size-3.5" />}
          onClick={() =>
            rodar(() => pauseCampaignAction({ campaignId: campaign.id }), 'Campanha pausada')
          }
        >
          {rotulo('Pausar')}
        </Button>
      ) : null}
      {canResumeCampaign(campaign.status) ? (
        <Button
          variant={variant}
          size={size}
          disabled={isPending}
          aria-label="Retomar campanha"
          icon={<Play className="size-3.5" />}
          onClick={() =>
            rodar(() => resumeCampaignAction({ campaignId: campaign.id }), 'Campanha retomada')
          }
        >
          {rotulo('Retomar')}
        </Button>
      ) : null}
      {canCancelCampaign(campaign.status) ? (
        <Button
          variant={variant}
          size={size}
          disabled={isPending}
          aria-label="Cancelar campanha"
          icon={<Ban className="size-3.5" />}
          onClick={() => setConfirmando('cancelar')}
        >
          {rotulo('Cancelar')}
        </Button>
      ) : null}
      {campaign.status !== 'em_andamento' ? (
        <Button
          variant={variant}
          size={size}
          disabled={isPending}
          aria-label={`Excluir campanha ${campaign.name}`}
          icon={<Trash2 className="size-3.5 text-danger" />}
          onClick={() => setConfirmando('excluir')}
        >
          {rotulo('Excluir')}
        </Button>
      ) : null}

      <ConfirmModal
        open={confirmando === 'cancelar'}
        title="Cancelar campanha"
        description={
          <span>
            Quem ainda está na fila não vai receber. Quem já recebeu, recebeu. A campanha{' '}
            <strong className="text-ink">{campaign.name}</strong> não poderá ser retomada.
          </span>
        }
        confirmLabel="Cancelar campanha"
        variant="danger"
        isLoading={isPending}
        onClose={() => setConfirmando(null)}
        onConfirm={() =>
          rodar(() => cancelCampaignAction({ campaignId: campaign.id }), 'Campanha cancelada')
        }
      />
      <ConfirmModal
        open={confirmando === 'excluir'}
        title="Excluir campanha"
        description={
          <span>
            O relatório de envio da campanha <strong className="text-ink">{campaign.name}</strong>{' '}
            será removido. As mensagens já enviadas continuam nas conversas.
          </span>
        }
        confirmLabel="Excluir campanha"
        variant="danger"
        isLoading={isPending}
        onClose={() => setConfirmando(null)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteCampaignAction({ campaignId: campaign.id });
            if (!result.ok) {
              show({ tone: 'erro', title: 'Não foi possível', description: result.error ?? '' });
              return;
            }
            setConfirmando(null);
            if (afterDelete) router.push(afterDelete);
            else router.refresh();
          })
        }
      />
    </div>
  );
}
