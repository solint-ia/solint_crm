import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { AgentActiveToggle } from '@/features/agentes-ia/components/agent-active-toggle';
import { AgentTabs, AGENT_TABS, type AgentTab } from '@/features/agentes-ia/components/agent-tabs';
import { AgentTester } from '@/features/agentes-ia/components/agent-tester';
import { TransferRules } from '@/features/agentes-ia/components/transfer-rules';
import {
  AgentConfigPanel,
  AgentKnowledgePanel,
  AgentLogsPanel,
} from '@/features/agentes-ia/components/agent-panels';
import { AgentDetailSkeleton } from '@/features/agentes-ia/components/agents-skeleton';
import { FlowBuilder } from '@/features/agentes-ia/components/flow-builder';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';
import { parseOneOf } from '@/lib/search-params';
import { sandboxReplyAction, setAgentActiveAction, toggleTransferRuleAction } from '../actions';

export const metadata: Metadata = { title: 'Configurar agente' };

export default async function AgenteDetalhePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab: AgentTab = parseOneOf(query.aba, AGENT_TABS, 'config');

  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'agentes-ia:ler')) return <AccessDenied permission="agentes-ia:ler" />;
  const agent = await container.aiAgents.findById(session.account.id, id);
  if (!agent) notFound();

  return (
    <Suspense fallback={<AgentDetailSkeleton />}>
      <AgenteDetalhe agentId={agent.id} tab={tab} />
    </Suspense>
  );
}

/**
 * A verificacao de existencia fica na pagina, antes do `<Suspense>`: assim o
 * `notFound()` acontece com o status ainda aberto e devolve 404 de verdade.
 */
async function AgenteDetalhe({
  agentId,
  tab,
}: {
  readonly agentId: string;
  readonly tab: AgentTab;
}) {
  const session = await container.session.getCurrentSession();
  const agent = await container.aiAgents.findById(session.account.id, agentId);
  if (!agent) notFound();

  const notifications = await container.notifications.list(session.account.id, session.user.id);

  return (
    <>
      <Topbar
        title={agent.name}
        subtitle={agent.scope}
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={
          <div className="flex items-center gap-3">
            <AgentActiveToggle
              agentId={agent.id}
              active={agent.active}
              setActive={setAgentActiveAction}
            />
            <Link
              href="/agentes-ia"
              className="flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-body font-semibold text-ink transition-colors hover:bg-surface-2"
            >
              <ArrowLeft className="size-3.5" />
              Voltar
            </Link>
          </div>
        }
      />

      <PageShell>
        <AgentTabs agentId={agent.id} current={tab} />

        <div className="mt-4">
          {tab === 'config' ? <AgentConfigPanel agent={agent} /> : null}
          {tab === 'conhecimento' ? <AgentKnowledgePanel agent={agent} /> : null}
          {tab === 'fluxo' ? (
            <FlowBuilder
              agentId={agent.id}
              initialFlow={agent.flow}
              canEdit={can(session, 'agentes-ia:escrever')}
            />
          ) : null}
          {tab === 'logs' ? <AgentLogsPanel agent={agent} /> : null}

          {tab === 'transferencia' ? (
            <Card className="max-w-3xl">
              <CardHeader
                title="Regras de transferência"
                description="Quando o agente deve passar a conversa para um humano"
              />
              <TransferRules
                agentId={agent.id}
                rules={agent.transferRules}
                toggleRule={toggleTransferRuleAction}
              />
            </Card>
          ) : null}

          {tab === 'teste' ? (
            <div className="max-w-2xl">
              <AgentTester
                agentId={agent.id}
                greeting={`Olá! Sou o ${agent.name}. Como posso ajudar hoje?`}
                reply={sandboxReplyAction}
              />
            </div>
          ) : null}
        </div>
      </PageShell>
    </>
  );
}
