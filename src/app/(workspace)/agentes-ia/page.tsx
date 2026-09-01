import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { Bot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { AgentsSkeleton } from '@/features/agentes-ia/components/agents-skeleton';
import { CreateAgentButton } from '@/features/agentes-ia/components/create-agent-button';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { FEATURES } from '@/config/features';
import { container } from '@/infrastructure/container';
import { formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Agentes de IA' };

/**
 * O `<Suspense>` está na pagina, e não num `loading.tsx`: a fronteira de um
 * `loading.tsx` cobre tambem `/agentes-ia/[id]` e faria o Next despachar 200
 * antes de a rota filha poder responder 404.
 */
export default function AgentesIaPage() {
  // Desligada para todo mundo, papel nenhum faz diferença — checado antes até
  // da sessão importar. Ver `src/config/features.ts`.
  if (!FEATURES.agentesIA) redirect('/conversas');

  return (
    <Suspense fallback={<AgentsSkeleton />}>
      <AgentesData />
    </Suspense>
  );
}

async function AgentesData() {
  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'agentes-ia:ler')) return <AccessDenied permission="agentes-ia:ler" />;
  const [agents, notifications] = await Promise.all([
    container.aiAgents.list(session.account.id),
    container.notifications.list(session.account.id, session.user.id),
  ]);

  return (
    <>
      <Topbar
        title="Agentes de IA"
        subtitle="Persona, base de conhecimento e regras de transferência"
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
      />

      <PageShell>
        {/* Ação da página fica com o conteúdo dela, não no cabeçalho: é onde
            as outras telas põem os botões, e é onde o olho procura. */}
        <div className="mb-4 flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body text-muted">
            {agents.length === 1 ? '1 agente criado' : `${agents.length} agentes criados`}
          </p>
          <CreateAgentButton />
        </div>

        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <li key={agent.id}>
              <Card className="h-full">
                <header className="flex items-start gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-control bg-cyan-soft text-cyan-text">
                    <Bot className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-ui font-semibold text-ink">
                      {agent.name}
                    </p>
                    <p className="truncate text-meta text-muted">{agent.scope}</p>
                  </div>
                  <Badge tone={agent.active ? 'green' : 'slate'} withDot>
                    {agent.active ? 'Ativo' : 'Desativado'}
                  </Badge>
                </header>

                <p className="mt-3 line-clamp-2 text-body text-muted">{agent.persona}</p>

                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
                  <div>
                    <dt className="text-meta text-dim">Atendimentos</dt>
                    <dd className="font-display text-ui font-semibold text-ink">
                      {formatNumber(agent.handledCount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-meta text-dim">Taxa de transferência</dt>
                    <dd className="font-display text-ui font-semibold text-ink">
                      {agent.transferRate}
                    </dd>
                  </div>
                </dl>

                <Link href={`/agentes-ia/${agent.id}` as Route} className="mt-3 block">
                  <Button variant="secondary" size="sm" fullWidth>
                    Configurar agente
                  </Button>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </PageShell>
    </>
  );
}
