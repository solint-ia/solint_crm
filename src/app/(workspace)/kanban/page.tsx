import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KanbanBoard } from '@/features/kanban/components/kanban-board';
import { can } from '@/core/domain/user';
import { NAV_ITEMS } from '@/config/navigation';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';
import { moveDealAction } from './actions';

export const metadata: Metadata = { title: 'Funil de Oportunidades · Solint CRM' };

export default async function KanbanPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedPipeline = Array.isArray(params.funil) ? params.funil[0] : params.funil;

  const session = await container.session.getCurrentSession();
  // A rail já esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'kanban:ler')) return <AccessDenied permission="kanban:ler" />;

  const pipelines = await container.pipelines.listPipelines(session.account.id);
  const pipeline = pipelines.find((item) => item.id === requestedPipeline) ?? pipelines[0];
  if (!pipeline) notFound();

  const [deals, notifications, settings] = await Promise.all([
    container.pipelines.listDeals(session.account.id, pipeline.id),
    container.notifications.list(session.account.id, session.user.id),
    // As etiquetas alimentam o vínculo etapa ↔ etiqueta no modal de etapas.
    container.settings.get(session.account.id),
  ]);

  const navItems = NAV_ITEMS.filter((item) => can(session, item.permission));

  return (
    <KanbanBoard
      pipelines={pipelines}
      pipeline={pipeline}
      deals={deals}
      account={session.account}
      accounts={session.availableAccounts}
      notifications={notifications}
      navItems={navItems}
      labels={settings.labels}
      moveDeal={moveDealAction.bind(null, pipeline.id)}
    />
  );
}

