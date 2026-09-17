import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { CampaignProgress } from '@/features/campanhas/components/campaign-progress';
import { CampaignTable } from '@/features/campanhas/components/campaign-table';
import { CampaignsEmpty } from '@/features/campanhas/components/campaigns-empty';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { FEATURES } from '@/config/features';
import { container } from '@/infrastructure/container';

export const metadata: Metadata = { title: 'Campanhas' };

/**
 * Campanhas: disparo de template aprovado para uma lista de contatos, por uma
 * caixa da API oficial.
 *
 * A lista mostra o que quem opera precisa ver de relance: em qual pé cada
 * campanha está, quantos já receberam e quantos responderam. O detalhe por
 * destinatário fica na página da campanha.
 */
export default async function CampanhasPage() {
  // Desligada para todo mundo, papel nenhum faz diferença — checado antes até
  // da sessão importar. Ver `src/config/features.ts`.
  if (!FEATURES.campanhas) redirect('/conversas');

  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'campanhas:ler')) return <AccessDenied permission="campanhas:ler" />;
  const [campaigns, inboxes, templates, notifications] = await Promise.all([
    container.campaigns.list(session.account.id),
    container.campaigns.listInboxes(session.account.id),
    container.campaigns.listTemplates(session.account.id),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  const podeDisparar = can(session, 'campanhas:disparar');
  const wabas = new Set(inboxes.map((inbox) => inbox.wabaId));
  const aprovados = templates.filter(
    (template) => template.approval === 'aprovado' && template.wabaId && wabas.has(template.wabaId),
  );
  const emAndamento = campaigns.filter((campaign) => campaign.status === 'em_andamento');

  return (
    <>
      <Topbar
        title="Campanhas"
        subtitle="Disparo de templates aprovados pela API oficial do WhatsApp"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/templates">
              <Button size="sm" variant="secondary" icon={<FileText className="size-3.5" />}>
                Templates
              </Button>
            </Link>
            {podeDisparar && inboxes.length > 0 && aprovados.length > 0 ? (
              <Link href="/campanhas/nova">
                <Button size="sm" icon={<Plus className="size-3.5" />}>
                  Nova campanha
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <PageShell>
        {inboxes.length === 0 || aprovados.length === 0 ? (
          <CampaignsEmpty semCaixa={inboxes.length === 0} />
        ) : null}

        {emAndamento.map((campaign) => (
          <div key={campaign.id} className="mb-4">
            <CampaignProgress campaign={campaign} />
          </div>
        ))}

        <CampaignTable campaigns={campaigns} canDispatch={podeDisparar} />
      </PageShell>
    </>
  );
}
