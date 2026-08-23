import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, MessageSquarePlus, UserPlus } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { SectionTitle } from '@/components/ui/section';
import { AgentRanking } from '@/features/dashboard/components/agent-ranking';
import { AttentionList } from '@/features/dashboard/components/attention-list';
import { ChannelDistribution } from '@/features/dashboard/components/channel-distribution';
import { FunnelSummary } from '@/features/dashboard/components/funnel-summary';
import { KpiCard } from '@/features/dashboard/components/kpi-card';
import {
  OperationStrip,
  type OperationSignal,
} from '@/features/dashboard/components/operation-strip';
import { PeriodSelector } from '@/features/dashboard/components/period-selector';
import { VolumeChart } from '@/features/dashboard/components/volume-chart';
import { PERIOD_LABELS } from '@/core/domain/analytics';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';
import { whatsappService } from '@/infrastructure/whatsapp/whatsapp-service';
import { parsePeriod } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Visão geral' };

export default async function DashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params.periodo);

  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'relatorios:ler')) return <AccessDenied permission="relatorios:ler" />;
  const [overview, notifications, conversations] = await Promise.all([
    container.analytics.getOverview(session.account.id, period),
    container.notifications.list(session.account.id, session.user.id),
    container.conversations.list(session.account.id, session.user.id, { scope: 'todas' }),
  ]);

  // A faixa de estado lê a operação de verdade, não o seed: é a única parte da
  // tela que responde "agora", e um número inventado aqui seria pior que nenhum.
  const open = conversations.filter((item) => item.status === 'aberta');
  const unassigned = open.filter((item) => !item.assigneeId);
  const unread = conversations.reduce((total, item) => total + item.unreadCount, 0);
  const waStatus = whatsappService.getStatus();
  const waConnected = waStatus.status === 'conectado';

  const signals: readonly OperationSignal[] = [
    {
      id: 'abertas',
      label: 'Conversas abertas',
      value: String(open.length),
      severity: 'neutro',
      hint: open.length === 1 ? '1 atendimento em curso' : `${open.length} atendimentos em curso`,
      href: '/conversas',
    },
    {
      id: 'sem-dono',
      label: 'Sem responsável',
      value: String(unassigned.length),
      severity: unassigned.length > 0 ? 'alerta' : 'neutro',
      hint: unassigned.length > 0 ? 'ninguém assumiu a fila' : 'toda a fila tem dono',
      href: '/conversas',
    },
    {
      id: 'nao-lidas',
      label: 'Mensagens não lidas',
      value: String(unread),
      severity: unread > 0 ? 'atencao' : 'neutro',
      hint: unread > 0 ? 'aguardando leitura' : 'tudo lido',
      href: '/conversas',
    },
    {
      id: 'canal',
      label: 'Canal WhatsApp',
      value: waConnected ? 'Online' : 'Offline',
      severity: waConnected ? 'neutro' : 'alerta',
      hint: waConnected
        ? (waStatus.phone ?? 'número conectado')
        : 'mensagens não serão entregues',
      href: '/configuracoes?secao=integracoes' as OperationSignal['href'],
    },
  ];

  return (
    <>
      <Topbar
        title="Visão geral"
        subtitle={`Bom trabalho, ${session.user.name.split(' ')[0]}. Aqui está a saúde do atendimento.`}
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={
          <Link
            href="/relatorios"
            className="rounded-control border border-line px-3 py-2 text-body font-semibold text-ink transition-colors hover:bg-surface-2"
          >
            Relatórios
          </Link>
        }
      />

      <PageShell className="p-0">
        {/* FAIXA 1 — o que precisa de mim agora */}
        <OperationStrip signals={signals} />

        <div className="p-4 md:p-6">
          {/* FAIXA 2 — atenção e desempenho do período */}
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <section>
              <SectionTitle
                title="Indicadores do período"
                action={<PeriodSelector basePath="/dashboard" current={period} />}
              />
              {/* `gap-px` sobre o fundo da linha desenha as divisorias: com
                  `border-l` no filho, o primeiro item de cada linha quebrada
                  ganharia um fio solto na borda da grade. */}
              <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-line bg-line md:grid-cols-3 xl:grid-cols-5">
                {overview.kpis.map((kpi) => (
                  <KpiCard key={kpi.id} kpi={kpi} />
                ))}
              </div>

              <div className="mt-7">
                <SectionTitle title="Volume de conversas" hint={PERIOD_LABELS[period].toLowerCase()} />
                <VolumeChart points={overview.volume} />
              </div>
            </section>

            <aside className="lg:border-l lg:border-line lg:pl-6">
              <SectionTitle title="Precisa de atenção" hint="maior tempo de espera" />
              <AttentionList items={overview.pendings} />

              <div className="mt-7">
                <SectionTitle title="Atalhos" />
                <div className="flex flex-col gap-1">
                  <ShortcutLink href="/conversas" icon={<MessageSquarePlus className="size-3.5" />}>
                    Nova conversa
                  </ShortcutLink>
                  <ShortcutLink href="/contatos" icon={<UserPlus className="size-3.5" />}>
                    Novo contato
                  </ShortcutLink>
                  <ShortcutLink href="/agentes-ia" icon={<Bot className="size-3.5" />}>
                    Novo agente de IA
                  </ShortcutLink>
                </div>
              </div>
            </aside>
          </div>

          {/* FAIXA 3 — tendência, abaixo da dobra */}
          <div className="mt-8 grid gap-6 border-t border-line pt-7 lg:grid-cols-3">
            <section>
              <SectionTitle title="Distribuição por canal" />
              <ChannelDistribution channels={overview.channels} />
            </section>

            <section className="lg:border-l lg:border-line lg:pl-6">
              <SectionTitle title="Ranking de agentes" hint="conversas atendidas" />
              <AgentRanking agents={overview.agents} />
            </section>

            <section className="lg:border-l lg:border-line lg:pl-6">
              <SectionTitle title="Funil resumido" hint="oportunidades por etapa" />
              <FunnelSummary stages={overview.funnel} />
            </section>
          </div>
        </div>
      </PageShell>
    </>
  );
}

function ShortcutLink({
  href,
  icon,
  children,
}: {
  readonly href: '/conversas' | '/contatos' | '/agentes-ia';
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-control px-2 py-1.5 text-body font-medium text-ink transition-colors hover:bg-surface-2"
    >
      <span className="text-dim">{icon}</span>
      {children}
    </Link>
  );
}
