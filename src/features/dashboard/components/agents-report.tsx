import type { AgentPerformance } from '@/core/domain/analytics';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyHint } from '@/components/ui/empty-state';

/**
 * Desempenho por agente no período.
 *
 * A coluna de tempo dizia só "Tempo medio" — de quê, não estava escrito, e o
 * valor é o de **primeira resposta**. Um cabeçalho ambíguo sobre uma métrica de
 * pessoas é o tipo de coisa que vira discussão de avaliação; o nome agora diz
 * qual é a medida.
 */
export function AgentsReport({ agents }: { readonly agents: readonly AgentPerformance[] }) {
  if (agents.length === 0) {
    return <EmptyHint>Nenhum atendimento atribuído no período selecionado.</EmptyHint>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-body">
        <caption className="sr-only">Desempenho por agente no período</caption>
        <thead className="border-b border-line text-meta tracking-wide text-dim uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">
              Agente
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Equipe
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Atendimentos
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Resolvidas
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              1ª resposta (média)
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              CSAT
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.id} className="border-b border-line-soft last:border-0">
              <th scope="row" className="px-4 py-3 font-normal">
                <span className="flex items-center gap-2">
                  <Avatar name={agent.name} tone={agent.avatarTone} size="xs" />
                  <span className="text-ink">{agent.name}</span>
                </span>
              </th>
              <td className="px-4 py-3 text-muted">{agent.team ?? '—'}</td>
              <td className="px-4 py-3 text-muted tabular-nums">{agent.handled}</td>
              <td className="px-4 py-3 text-muted tabular-nums">{agent.resolved ?? 0}</td>
              <td className="px-4 py-3 font-mono text-muted">{agent.averageResponse}</td>
              <td className="px-4 py-3">
                <Badge tone={agent.csatTone}>{agent.csat}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
