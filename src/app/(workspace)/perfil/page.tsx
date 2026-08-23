import type { Metadata } from 'next';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { ProfileView } from '@/features/perfil/components/profile-view';
import { container } from '@/infrastructure/container';
import { planned } from '@/components/ui/planned';

export const metadata: Metadata = { title: 'Meu perfil' };

export default async function PerfilPage() {
  const session = await container.session.getCurrentSession();
  const notifications = await container.notifications.list(
    session.account.id,
    session.user.id,
  );

  return (
    <>
      <Topbar
        title="Meu perfil"
        subtitle="Preferências e conta pessoal"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={
          <Button variant="danger" size="sm" icon={<LogOut className="size-3.5" />} {...planned('Encerrar todas as sessões ativas desta conta')}>
            Sair de todas as sessões
          </Button>
        }
      />

      <PageShell>
        <ProfileView session={session} />
      </PageShell>
    </>
  );
}
