import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { CampaignWizard } from '@/features/campanhas/components/campaign-wizard';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { FEATURES } from '@/config/features';
import { container } from '@/infrastructure/container';

export const metadata: Metadata = { title: 'Nova campanha' };

export default async function NovaCampanhaPage() {
  if (!FEATURES.campanhas) redirect('/conversas');

  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'campanhas:disparar')) return <AccessDenied permission="campanhas:disparar" />;
  const [segments, templates, notifications] = await Promise.all([
    container.campaigns.listSegments(session.account.id),
    container.campaigns.listTemplates(session.account.id),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  return (
    <>
      <Topbar
        title="Nova campanha"
        subtitle="Disparo em massa por modelo aprovado do WhatsApp"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={
          <Link href="/campanhas">
            <Button variant="secondary" size="sm" icon={<ArrowLeft className="size-3.5" />}>
              Voltar para campanhas
            </Button>
          </Link>
        }
      />

      <PageShell>
        <CampaignWizard segments={segments} templates={templates} />
      </PageShell>
    </>
  );
}
