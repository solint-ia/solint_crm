import type { Metadata } from 'next';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { canSeeInbox } from '@/core/domain/user';
import { ProfileView } from '@/features/perfil/components/profile-view';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { LogoutAllSessionsButton } from '@/features/perfil/components/logout-all-sessions-button';

export const metadata: Metadata = { title: 'Meu perfil' };

export default async function PerfilPage() {
  const session = await container.session.getCurrentSession();
  const [notifications, inboxes] = await Promise.all([
    container.notifications.list(session.account.id, session.user.id),
    /**
     * Todas as caixas que a pessoa alcança, não uma.
     *
     * O perfil mostrava um cartão só, alimentado pela rota global de status —
     * que resolve a caixa no servidor com um `findFirst` e devolve sempre a
     * mesma. Numa conta com três números, dois deles simplesmente não existiam
     * nesta tela.
     */
    prisma.inbox.findMany({
      where: { accountId: session.account.id, channel: 'whatsapp' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const minhasCaixas = inboxes.filter((inbox) => canSeeInbox(session, inbox.id));

  return (
    <>
      <Topbar
        title="Meu perfil"
        subtitle="Preferências e conta pessoal"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={<LogoutAllSessionsButton />}
      />

      <PageShell>
        <ProfileView session={session} inboxes={minhasCaixas} />
      </PageShell>
    </>
  );
}
