import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { CAMPAIGN_STATUS_TONE } from '@/components/domain/presentation-maps';
import { CampaignProgress } from '@/features/campanhas/components/campaign-progress';
import { CampaignActions } from '@/features/campanhas/components/campaign-actions';
import { RecipientsTable } from '@/features/campanhas/components/recipients-table';
import { CAMPAIGN_STATUS_LABELS } from '@/core/domain/campaign';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { FEATURES } from '@/config/features';
import { container } from '@/infrastructure/container';
import { dataHoraLabel } from '@/lib/datetime';

export const metadata: Metadata = { title: 'Campanha' };

export default async function CampanhaPage(props: {
  readonly params: Promise<{ campaignId: string }>;
}) {
  if (!FEATURES.campanhas) redirect('/conversas');
  const { campaignId } = await props.params;

  const session = await container.session.getCurrentSession();
  if (!can(session, 'campanhas:ler')) return <AccessDenied permission="campanhas:ler" />;

  const campaign = await container.campaigns.findById(session.account.id, campaignId);
  if (!campaign) notFound();

  const [recipients, notifications] = await Promise.all([
    container.campaigns.listRecipients(session.account.id, campaignId),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  return (
    <>
      <Topbar
        title={campaign.name}
        subtitle={`${campaign.templateName} · ${campaign.audienceLabel}`}
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={
          <Link href="/campanhas">
            <Button variant="secondary" size="sm" icon={<ArrowLeft className="size-3.5" />}>
              Campanhas
            </Button>
          </Link>
        }
      />

      <PageShell>
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-2">
                <div>
                  <dt className="text-meta text-dim">Status</dt>
                  <dd>
                    <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]} withDot>
                      {CAMPAIGN_STATUS_LABELS[campaign.status]}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-meta text-dim">Caixa de entrada</dt>
                  <dd className="text-ink">
                    {campaign.inboxName} · <span className="font-mono">{campaign.inboxPhone}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-meta text-dim">Disparo</dt>
                  <dd className="text-ink">
                    {campaign.scheduledLabel} · {campaign.rateLimit}/min
                  </dd>
                </div>
                <div>
                  <dt className="text-meta text-dim">Criada em</dt>
                  <dd className="text-ink">{dataHoraLabel(new Date(campaign.createdAt))}</dd>
                </div>
              </dl>
              {can(session, 'campanhas:disparar') ? (
                <CampaignActions campaign={campaign} afterDelete="/campanhas" />
              ) : null}
            </div>
            {campaign.lastError ? (
              <p className="mt-3 rounded-control bg-red-soft px-3 py-2 text-meta text-red-text">
                Pausada pelo sistema: {campaign.lastError}
              </p>
            ) : null}
            <div className="mt-4 rounded-surface bg-chat p-3">
              <p className="mb-1 text-meta font-semibold text-dim uppercase">Template</p>
              <p className="whitespace-pre-wrap rounded-bubble rounded-bl-sm border border-line bg-surface px-3 py-2 text-body text-ink">
                {campaign.templateBody}
              </p>
            </div>
          </Card>

          <CampaignProgress campaign={campaign} />

          <RecipientsTable recipients={recipients} />
        </div>
      </PageShell>
    </>
  );
}
