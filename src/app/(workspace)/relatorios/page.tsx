import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { Download } from 'lucide-react';
import { PERIOD_LABELS, PREVIOUS_PERIOD_LABELS } from '@/core/domain/analytics';
import { Section } from '@/components/ui/section';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { PeriodSelector } from '@/features/dashboard/components/period-selector';
import {
  ReportTabs,
  REPORT_TABS,
  type ReportTab,
} from '@/features/dashboard/components/report-tabs';
import { ComparisonTable } from '@/features/dashboard/components/comparison-table';
import { VolumeChart } from '@/features/dashboard/components/volume-chart';
import { AgentsReport } from '@/features/dashboard/components/agents-report';
import { FunnelReport } from '@/features/dashboard/components/funnel-report';
import { CsatReport } from '@/features/dashboard/components/csat-report';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';
import { parseOneOf, parsePeriod } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Relatórios' };

export default async function RelatoriosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params.periodo);
  const tab: ReportTab = parseOneOf(params.aba, REPORT_TABS, 'conversas');
  // A comparação fica na URL para ser compartilhável junto com o recorte.
  const comparing = params.comparar === '1' || tab === 'comparativo';

  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'relatorios:ler')) return <AccessDenied permission="relatorios:ler" />;
  const [report, notifications] = await Promise.all([
    container.analytics.getReport(session.account.id, period, session.inboxAccess),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  const exportHref = `/api/relatorios/export?aba=${tab}&periodo=${period}`;

  return (
    <>
      <Topbar
        title="Relatórios e analytics"
        subtitle="Desempenho de atendimento, funil e satisfação"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
      />

      <PageShell>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <ReportTabs current={tab} period={period} />

          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector basePath="/relatorios" current={period} extraParams={{ aba: tab }} />

            {/* Link direto: o servidor manda `Content-Disposition`, então o
                download acontece sem uma linha de JavaScript no cliente. */}
            <a
              href={exportHref}
              download
              className="inline-flex h-8 items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-body font-semibold text-ink shadow-xs transition-colors hover:bg-surface-2"
            >
              <Download className="size-3.5" />
              Exportar CSV
            </a>
          </div>
        </div>

        {tab === 'conversas' ? (
          <Section
            title="Série temporal de conversas"
            hint={PERIOD_LABELS[period].toLowerCase()}
            action={
              <Link
                href={
                  `/relatorios?aba=conversas&periodo=${period}${comparing ? '' : '&comparar=1'}` as Route
                }
                className="text-meta font-semibold text-brand hover:underline"
              >
                {comparing ? 'Ocultar período anterior' : 'Comparar com período anterior'}
              </Link>
            }
          >
            <VolumeChart
              points={report.volume}
              {...(comparing
                ? {
                    previous: report.previousVolume,
                    previousLabel: PREVIOUS_PERIOD_LABELS[period],
                  }
                : {})}
            />
          </Section>
        ) : null}

        {tab === 'comparativo' ? (
          <Section
            title="Comparativo entre períodos"
            hint={`${PERIOD_LABELS[period].toLowerCase()} contra ${PREVIOUS_PERIOD_LABELS[
              period
            ].toLowerCase()}`}
          >
            <ComparisonTable rows={report.comparison} period={period} />
            <p className="mt-3 max-w-[65ch] text-meta leading-relaxed text-dim">
              Tempo de resposta, tempo de resolução e conversas sem resposta melhoram quando
              caem — por isso uma queda aparece em verde nessas linhas.
            </p>
          </Section>
        ) : null}

        {tab === 'agentes' ? (
          <Section title="Desempenho por agente" hint={PERIOD_LABELS[period].toLowerCase()}>
            <AgentsReport agents={report.agents} />
          </Section>
        ) : null}

        {tab === 'funil' ? (
          <FunnelReport conversions={report.conversions} lossReasons={report.lossReasons} />
        ) : null}

        {tab === 'csat' ? (
          <CsatReport
            distribution={report.csatDistribution}
            comments={report.csatComments}
          />
        ) : null}
      </PageShell>
    </>
  );
}
