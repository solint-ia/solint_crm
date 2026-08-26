import type { Metadata } from 'next';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { AccessDenied } from '@/components/layout/access-denied';
import { PERIOD_LABELS } from '@/core/domain/analytics';
import { can } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { parsePeriod } from '@/lib/search-params';

import { DashboardHeader } from '@/features/dashboard/components/dashboard-header';
import { KpiGrid } from '@/features/dashboard/components/kpi-grid';
import { QuickShortcuts } from '@/features/dashboard/components/quick-shortcuts';
import { AttentionPanel } from '@/features/dashboard/components/attention-panel';
import { VolumeChartCard } from '@/features/dashboard/components/volume-chart-card';
import { ChannelDistributionCard } from '@/features/dashboard/components/channel-distribution-card';
import { AgentRankingCard } from '@/features/dashboard/components/agent-ranking-card';
import { FunnelSummaryCard } from '@/features/dashboard/components/funnel-summary-card';

export const metadata: Metadata = { title: 'Visão geral' };

export default async function DashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params.periodo);

  const session = await container.session.getCurrentSession();
  if (!can(session, 'relatorios:ler')) {
    return <AccessDenied permission="relatorios:ler" />;
  }

  const [overview, notifications] = await Promise.all([
    container.analytics.getOverview(session.account.id, period, session.inboxAccess),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  const periodLabel = PERIOD_LABELS[period] || 'Últimos 7 dias';

  return (
    <>
      <Topbar
        title="Visão geral"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
      />

      <PageShell className="p-0">
        {/* Cabeçalho Rico com Saudação e Seletor de Período */}
        <DashboardHeader userName={session.user.name} period={period} />

        <div className="flex flex-col gap-6 p-4 sm:p-6">
          {/* Linha 1: Grade com 6 KPIs Principais */}
          <section aria-label="Indicadores principais">
            <KpiGrid kpis={overview.kpis} />
          </section>

          {/* Linha 2: Atalhos Rápidos de Operação */}
          <section aria-label="Ações rápidas">
            <QuickShortcuts />
          </section>

          {/* Linha 3: Gráfico de Volume & Painel Precisa de Atenção */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section className="lg:col-span-2" aria-label="Volume de atendimentos">
              <VolumeChartCard points={overview.volume} periodLabel={periodLabel} />
            </section>

            <aside className="lg:col-span-1" aria-label="Atendimentos prioritários">
              <AttentionPanel items={overview.pendings} />
            </aside>
          </div>

          {/* Linha 4: Indicadores de Desempenho e Distribuição */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <section aria-label="Canais de atendimento">
              <ChannelDistributionCard channels={overview.channels} />
            </section>

            <section aria-label="Ranking de atendentes">
              <AgentRankingCard agents={overview.agents} />
            </section>

            <section aria-label="Funil de vendas">
              <FunnelSummaryCard stages={overview.funnel} />
            </section>
          </div>
        </div>
      </PageShell>
    </>
  );
}
