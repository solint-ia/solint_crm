import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { CampaignProgress } from '@/features/campanhas/components/campaign-progress';
import { CampaignTable } from '@/features/campanhas/components/campaign-table';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { FEATURES } from '@/config/features';
import { container } from '@/infrastructure/container';

export const metadata: Metadata = { title: 'Campanhas' };

export default async function CampanhasPage() {
  // Desligada para todo mundo, papel nenhum faz diferença — checado antes até
  // da sessão importar. Ver `src/config/features.ts`.
  if (!FEATURES.campanhas) redirect('/conversas');

  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'campanhas:ler')) return <AccessDenied permission="campanhas:ler" />;
  const [campaigns, templates, notifications] = await Promise.all([
    container.campaigns.list(session.account.id),
    container.campaigns.listTemplates(session.account.id),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  const running = campaigns.find((campaign) => campaign.status === 'em_andamento');
  const approvedTemplates = templates.filter((template) => template.approval === 'aprovado');

  return (
    <>
      <Topbar
        title="Disparos em massa"
        subtitle="Campanhas por template aprovado do WhatsApp"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={
          <Link href="/campanhas/nova">
            <Button size="sm" icon={<Plus className="size-3.5" />}>
              Nova campanha
            </Button>
          </Link>
        }
      />

      <PageShell>
        {approvedTemplates.length < 3 ? (
          <p className="mb-4 flex items-center gap-2 rounded-control border border-note-line bg-note px-3 py-2.5 text-body text-note-text">
            <AlertTriangle className="size-4 shrink-0" />
            Você tem apenas {approvedTemplates.length} template(s) aprovado(s). Envie novos modelos
            para aprovação da Meta antes de escalar os disparos.
          </p>
        ) : null}

        {running ? (
          <div className="mb-4">
            <CampaignProgress campaign={running} />
          </div>
        ) : null}

        <CampaignTable campaigns={campaigns} />
      </PageShell>
    </>
  );
}
