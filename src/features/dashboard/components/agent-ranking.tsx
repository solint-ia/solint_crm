import type { AgentPerformance } from '@/core/domain/analytics';
import { Avatar } from '@/components/ui/avatar';

export function AgentRanking({ agents }: { readonly agents: readonly AgentPerformance[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {agents.map((agent) => (
        <li key={agent.id} className="flex items-center gap-2.5">
          <Avatar name={agent.name} tone={agent.avatarTone} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-ink">{agent.name}</p>
            <p className="text-meta text-dim">TMR {agent.averageResponse}</p>
          </div>
          <span className="font-display text-ui font-semibold text-ink">{agent.handled}</span>
        </li>
      ))}
    </ul>
  );
}
