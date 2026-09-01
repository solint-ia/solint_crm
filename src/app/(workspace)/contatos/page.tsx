import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { ContactsExplorer } from '@/features/contatos/components/contacts-explorer';
import { ContactsSkeleton } from '@/features/contatos/components/contacts-skeleton';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';

export const metadata: Metadata = { title: 'Contatos' };

/**
 * O `<Suspense>` está na pagina, e não num `loading.tsx`: a fronteira de um
 * `loading.tsx` cobre tambem `/contatos/[id]` e faria o Next despachar 200
 * antes de a rota filha poder responder 404.
 */
export default function ContatosPage() {
  return (
    <Suspense fallback={<ContactsSkeleton />}>
      <ContatosData />
    </Suspense>
  );
}

async function ContatosData() {
  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'contatos:ler')) return <AccessDenied permission="contatos:ler" />;
  const [contacts, notifications] = await Promise.all([
    container.useCases.listContacts(session.account.id),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  return (
    <>
      <Topbar
        title="Contatos"
        subtitle={`${contacts.length} contatos na base`}
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
      />
      <PageShell>
        <ContactsExplorer contacts={contacts} canExport={can(session, 'contatos:exportar')} />
      </PageShell>
    </>
  );
}
