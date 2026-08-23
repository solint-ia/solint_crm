import Link from 'next/link';
import type { Route } from 'next';
import { cn } from '@/lib/cn';

export const AGENT_TABS = [
  'config',
  'conhecimento',
  'transferencia',
  'fluxo',
  'teste',
  'logs',
] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

const LABELS: Readonly<Record<AgentTab, string>> = {
  config: 'Configuração',
  conhecimento: 'Base de conhecimento',
  transferencia: 'Regras de transferência',
  fluxo: 'Fluxo visual',
  teste: 'Testar agente',
  logs: 'Logs',
};

export function AgentTabs({
  agentId,
  current,
}: {
  readonly agentId: string;
  readonly current: AgentTab;
}) {
  return (
    <nav aria-label="Secoes do agente" className="flex flex-wrap gap-1 rounded-control bg-surface-2 p-1">
      {AGENT_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/agentes-ia/${agentId}?aba=${tab}` as Route}
          aria-current={tab === current ? 'true' : undefined}
          className={cn(
            'rounded-control px-3 py-1.5 text-body font-semibold transition-colors',
            tab === current ? 'bg-surface text-brand shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
