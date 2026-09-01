import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KanbanBoard } from '@/features/kanban/components/kanban-board';
import { can } from '@/core/domain/user';
import { visiblePipelines } from '@/core/domain/pipeline';
import { NAV_ITEMS, reachesNavItem } from '@/config/navigation';
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

  /**
   * Só os funis das caixas que a pessoa alcança.
   *
   * Mesmo eixo que já governa as conversas: `inboxAccess`. Sem isto, um
   * colaborador restrito a uma equipe veria no Kanban os negócios de um canal
   * cujas conversas ele não pode nem abrir — e o total do funil somaria valores
   * de um setor que não é dele.
   */
  const pipelines = visiblePipelines(
    await container.pipelines.listPipelines(session.account.id),
    session.inboxAccess,
  );
  // Um `?funil=` de fora do alcance cai no primeiro permitido, e não em 404:
  // do ponto de vista de quem pediu, aquele funil simplesmente não existe.
  const pipeline = pipelines.find((item) => item.id === requestedPipeline) ?? pipelines[0];
  if (!pipeline) notFound();

  const [deals, notifications, settings] = await Promise.all([
    container.pipelines.listDeals(session.account.id, pipeline.id),
    container.notifications.list(session.account.id, session.user.id),
    // As etiquetas alimentam o vínculo etapa ↔ etiqueta no modal de etapas.
    container.settings.get(session.account.id),
  ]);

  const navItems = NAV_ITEMS.filter((item) => reachesNavItem(session.permissions, item));

  return (
    <KanbanBoard
      pipelines={pipelines}
      pipeline={pipeline}
      deals={deals}
      account={session.account}
      accounts={session.availableAccounts}
      user={session.user}
      notifications={notifications}
      navItems={navItems}
      labels={settings.labels}
      moveDeal={moveDealAction.bind(null, pipeline.id)}
    />
  );
}

