import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { CampaignWizard } from '@/features/campanhas/components/campaign-wizard';
import { CampaignsEmpty } from '@/features/campanhas/components/campaigns-empty';
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
  const [inboxes, audiences, templates, notifications] = await Promise.all([
    container.campaigns.listInboxes(session.account.id),
    container.campaigns.listAudiences(session.account.id),
    container.campaigns.listTemplates(session.account.id),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  // Só o que a Meta aceita: aprovado e da conta do WhatsApp Business de alguma
  // caixa oficial. O assistente ainda filtra pela caixa escolhida.
  const wabas = new Set(inboxes.map((inbox) => inbox.wabaId));
  const aprovados = templates.filter(
    (template) => template.approval === 'aprovado' && template.wabaId && wabas.has(template.wabaId),
  );

  return (
    <>
      <Topbar
        title="Nova campanha"
        subtitle="Template aprovado, público e ritmo do disparo"
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
        {inboxes.length === 0 || aprovados.length === 0 ? (
          <CampaignsEmpty semCaixa={inboxes.length === 0} />
        ) : (
          <CampaignWizard inboxes={inboxes} audiences={audiences} templates={aprovados} />
        )}
      </PageShell>
    </>
  );
}
