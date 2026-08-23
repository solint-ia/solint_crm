import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Topbar } from '@/components/layout/topbar';
import { KanbanBoard } from '@/features/kanban/components/kanban-board';
import { PipelineSelector } from '@/features/kanban/components/pipeline-selector';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';
import { moveDealAction } from './actions';

export const metadata: Metadata = { title: 'Kanban' };

export default async function KanbanPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedPipeline = Array.isArray(params.funil) ? params.funil[0] : params.funil;

  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'kanban:ler')) return <AccessDenied permission="kanban:ler" />;
  const pipelines = await container.pipelines.listPipelines(session.account.id);
  const pipeline = pipelines.find((item) => item.id === requestedPipeline) ?? pipelines[0];
  if (!pipeline) notFound();

  const [deals, notifications] = await Promise.all([
    container.pipelines.listDeals(session.account.id, pipeline.id),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  return (
    <>
      <Topbar
        title="Funil de oportunidades"
        subtitle="Arraste os cards entre etapas para atualizar o funil"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={<PipelineSelector pipelines={pipelines} currentId={pipeline.id} />}
      />

      <KanbanBoard
        pipelines={pipelines}
        pipeline={pipeline}
        deals={deals}
        moveDeal={moveDealAction.bind(null, pipeline.id)}
      />
    </>
  );
}
