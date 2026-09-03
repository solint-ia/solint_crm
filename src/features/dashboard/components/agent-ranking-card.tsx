'use client';

import { useMemo, useState } from 'react';
import { Award, MessageSquare, Star } from 'lucide-react';
import type { AgentPerformance } from '@/core/domain/analytics';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

interface AgentRankingCardProps {
  readonly agents: readonly AgentPerformance[];
}

type RankingMetric = 'atendidas' | 'resolvidas' | 'csat';

const METRICAS: readonly {
  readonly id: RankingMetric;
  readonly label: string;
  readonly icon: React.ElementType;
  /** Quanto maior melhor? Decide a ordem e o sentido da barra. */
  readonly maiorEhMelhor: boolean;
}[] = [
  { id: 'atendidas', label: 'Atendidas', icon: MessageSquare, maiorEhMelhor: true },
  { id: 'resolvidas', label: 'Resolvidas', icon: Award, maiorEhMelhor: true },
  { id: 'csat', label: 'CSAT', icon: Star, maiorEhMelhor: true },
];

/**
 * "4,9" volta a ser 4.9; "—" vira `undefined`.
 *
 * O travessão é o que o servidor manda quando não há dado — e `parseFloat('—')`
 * é `NaN`, que faz toda comparação de ordenação responder `false`. O ranking
 * ficava numa ordem arbitrária assim que alguém da equipe não tinha nota.
 */
const numeroDe = (texto: string): number | undefined => {
  const valor = Number.parseFloat(texto.replace(',', '.'));
  return Number.isFinite(valor) ? valor : undefined;
};

/**
 * O ranking da equipe.
 *
 * O painel prioriza volume concluído e satisfação. Tempo de primeira resposta
 * saiu daqui junto com os relatórios, para a mesma métrica não reaparecer com
 * outro formato logo abaixo dos indicadores principais.
 *
 * A barra ao lado de cada linha é a comparação que uma lista de números não dá:
 * quem lê descobre num relance se o primeiro colocado está à frente por pouco
 * ou pelo dobro.
 */
export function AgentRankingCard({ agents }: AgentRankingCardProps) {
  const [metric, setMetric] = useState<RankingMetric>('atendidas');
  const ativa = METRICAS.find((item) => item.id === metric) ?? METRICAS[0]!;

  const linhas = useMemo(() => {
    const valorDe = (agent: AgentPerformance): number | undefined => {
      switch (metric) {
        case 'atendidas':
          return agent.handled;
        case 'resolvidas':
          return agent.resolved ?? 0;
        case 'csat':
          return numeroDe(agent.csat);
      }
    };

    const rotuloDe = (agent: AgentPerformance): string => {
      switch (metric) {
        case 'atendidas':
          return String(agent.handled);
        case 'resolvidas':
          return String(agent.resolved ?? 0);
        case 'csat':
          return agent.csat;
      }
    };

    return agents
      .map((agent) => ({ agent, valor: valorDe(agent), rotulo: rotuloDe(agent) }))
      .toSorted((a, b) => {
        // Quem não tem dado vai para o fim, sempre — em qualquer métrica.
        if (a.valor === undefined) return b.valor === undefined ? 0 : 1;
        if (b.valor === undefined) return -1;
        return ativa.maiorEhMelhor ? b.valor - a.valor : a.valor - b.valor;
      });
  }, [agents, metric, ativa.maiorEhMelhor]);

  const maior = Math.max(1, ...linhas.map((linha) => linha.valor ?? 0));
  const semDados = linhas.every((linha) => linha.valor === undefined || linha.valor === 0);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <div className="flex flex-col gap-3 border-b border-line pb-3.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Award className="size-4" />
          </div>
          <div>
            <h2 className="font-display text-sm font-bold text-ink">Desempenho da equipe</h2>
            <p className="text-[11px] text-muted">
              {ativa.maiorEhMelhor ? 'Do maior para o menor' : 'Do mais rápido para o mais lento'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-0.5 rounded-xl bg-surface-2 p-1 text-[11px]">
          {METRICAS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMetric(item.id)}
              aria-pressed={metric === item.id}
              className={cn(
                'rounded-lg px-2 py-1 font-semibold transition-all',
                metric === item.id
                  ? 'bg-surface font-bold text-ink shadow-2xs'
                  : 'text-muted hover:text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {linhas.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted">
          Nenhum atendente cadastrado nesta conta ainda.
        </p>
      ) : (
        <ul className="mt-3.5 flex flex-1 flex-col gap-2.5">
          {linhas.map((linha, index) => {
            const lider = index === 0 && !semDados && linha.valor !== undefined;
            const fracao =
              linha.valor === undefined || maior === 0
                ? 0
                : ativa.maiorEhMelhor
                  ? linha.valor / maior
                  : 1 - (linha.valor / maior) * 0.85;

            return (
              <li key={linha.agent.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums',
                        lider ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'text-dim',
                      )}
                    >
                      {index + 1}
                    </span>
                    <Avatar name={linha.agent.name} tone={linha.agent.avatarTone} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-ink">{linha.agent.name}</p>
                      <p className="truncate text-[11px] text-muted">
                        {linha.agent.team || 'Atendimento'}
                      </p>
                    </div>
                  </div>

                  <span
                    className={cn(
                      'shrink-0 font-display text-sm font-bold tabular-nums',
                      linha.valor === undefined ? 'text-dim' : 'text-ink',
                    )}
                  >
                    {linha.rotulo}
                  </span>
                </div>

                <div className="ml-[4.375rem] h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(linha.valor ? 4 : 0, fracao * 100)}%`,
                      backgroundColor: lider ? 'var(--color-chart-1)' : 'var(--color-chart-2)',
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {semDados ? (
        <p className="mt-3 border-t border-line pt-2.5 text-center text-[11px] text-dim">
          {metric === 'csat'
            ? 'Nenhuma avaliação recebida no período. Ligue a pesquisa de satisfação nas configurações da caixa.'
            : 'Sem atendimentos atribuídos no período selecionado.'}
        </p>
      ) : null}
    </div>
  );
}
