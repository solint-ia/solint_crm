import type { Metadata } from 'next';
import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { AccessDenied } from '@/components/layout/access-denied';
import { FEATURES } from '@/config/features';
import { can, canManageTemplates } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { TemplatesManager } from '@/features/templates/components/templates-manager';

export const metadata: Metadata = { title: 'Campanhas e templates' };

/**
 * Templates da API oficial do WhatsApp, por conta do WhatsApp Business (WABA).
 *
 * A Meta é a dona da lista: o que está aqui veio dela pela sincronização ou
 * foi criado aqui e mandado para a análise dela. A tela não edita template
 * aprovado — a Meta não permite, e fingir que dá criaria um texto no CRM
 * diferente do que chega no aparelho do cliente.
 */
export default async function TemplatesPage() {
  const session = await container.session.getCurrentSession();
  // A rail já esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'campanhas:ler')) return <AccessDenied permission="campanhas:ler" />;
  if (!canManageTemplates(session)) return <AccessDenied permission="campanhas:disparar" />;

  const accountId = session.account.id;
  const [conexoes, templates, notifications] = await Promise.all([
    prisma.whatsAppCloudConnection.findMany({
      where: { accountId, status: { not: 'desconectado' } },
      select: {
        inboxId: true,
        wabaId: true,
        displayPhoneNumber: true,
        verifiedName: true,
        status: true,
        inbox: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.messageTemplate.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        body: true,
        headerContent: true,
        footer: true,
        rejectedReason: true,
        wabaId: true,
        createdAt: true,
      },
      orderBy: [{ name: 'asc' }, { language: 'asc' }],
    }),
    container.notifications.list(accountId, session.user.id),
  ]);

  return (
    <>
      <Topbar
        title="Campanhas e templates"
        subtitle="Modelos aprovados pela Meta para a API oficial do WhatsApp"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={
          FEATURES.campanhas ? (
            <Link href="/campanhas">
              <Button size="sm" variant="secondary" icon={<Megaphone className="size-3.5" />}>
                Ver campanhas
              </Button>
            </Link>
          ) : undefined
        }
      />

      <PageShell>
        <TemplatesManager
          inboxes={conexoes.map((c) => ({
            id: c.inboxId,
            name: c.inbox.name,
            phone: c.displayPhoneNumber,
            verifiedName: c.verifiedName ?? undefined,
            wabaId: c.wabaId,
            status: c.status,
          }))}
          templates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            body: t.body,
            headerContent: t.headerContent,
            footer: t.footer,
            rejectedReason: t.rejectedReason,
            wabaId: t.wabaId,
            createdAt: t.createdAt.toISOString(),
          }))}
        />
      </PageShell>
    </>
  );
}
