'use client';

import { useMemo, useState } from 'react';
import { Award, Clock, Star } from 'lucide-react';



import type { AgentPerformance } from '@/core/domain/analytics';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

interface AgentRankingCardProps {
  readonly agents: readonly AgentPerformance[];
}

type RankingMetric = 'atendidas' | 'resolvidas' | 'tmr' | 'csat';

export function AgentRankingCard({ agents }: AgentRankingCardProps) {
  const [metric, setMetric] = useState<RankingMetric>('atendidas');

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      if (metric === 'atendidas') return b.handled - a.handled;
      if (metric === 'resolvidas') return (b.resolved ?? b.handled) - (a.resolved ?? a.handled);
      if (metric === 'csat') return parseFloat(b.csat.replace(',', '.')) - parseFloat(a.csat.replace(',', '.'));
      return b.handled - a.handled;
    });
  }, [agents, metric]);

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <div>
        <div className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Award className="size-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold text-ink">Desempenho da equipe</h2>
              <p className="text-[11px] text-muted">Acompanhamento e eficiência dos agentes</p>
            </div>
          </div>

          {/* Seletor de Métrica */}
          <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1 text-[11px]">
            <button
              type="button"
              onClick={() => setMetric('atendidas')}
              className={cn(
                'rounded-lg px-2 py-0.5 font-semibold transition-all',
                metric === 'atendidas' ? 'bg-surface text-ink shadow-2xs font-bold' : 'text-muted hover:text-ink',
              )}
            >
              Atendidas
            </button>
            <button
              type="button"
              onClick={() => setMetric('tmr')}
              className={cn(
                'rounded-lg px-2 py-0.5 font-semibold transition-all',
                metric === 'tmr' ? 'bg-surface text-ink shadow-2xs font-bold' : 'text-muted hover:text-ink',
              )}
            >
              TMR
            </button>
            <button
              type="button"
              onClick={() => setMetric('csat')}
              className={cn(
                'rounded-lg px-2 py-0.5 font-semibold transition-all',
                metric === 'csat' ? 'bg-surface text-ink shadow-2xs font-bold' : 'text-muted hover:text-ink',
              )}
            >
              CSAT
            </button>
          </div>
        </div>

        {/* Lista de Atendentes */}
        <ul className="mt-3.5 divide-y divide-line-soft">
          {sortedAgents.map((agent, index) => {
            const isLeader = index === 0;

            return (
              <li key={agent.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    isLeader ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'text-muted',
                  )}>
                    {index + 1}
                  </span>

                  <Avatar name={agent.name} tone={agent.avatarTone} size="sm" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-ink">{agent.name}</p>
                    <p className="truncate text-[11px] text-muted">{agent.team || 'Atendimento'}</p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 text-right">
                  {metric === 'atendidas' && (
                    <span className="font-display text-sm font-bold text-ink tabular-nums">
                      {agent.handled} <span className="text-[10px] font-normal text-muted">atendimentos</span>
                    </span>
                  )}

                  {metric === 'tmr' && (
                    <span className="flex items-center gap-1 font-display text-xs font-bold text-ink tabular-nums">
                      <Clock className="size-3 text-muted" /> {agent.averageResponse}
                    </span>
                  )}

                  {metric === 'csat' && (
                    <span className="flex items-center gap-1 font-display text-xs font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                      <Star className="size-3 fill-amber-500 text-amber-500" /> {agent.csat}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-3 border-t border-line pt-2.5 text-center">
        <span className="text-[11px] text-muted">
          Meta da equipe: <strong>&lt; 2 min</strong> de 1ª resposta e CSAT <strong>&gt; 4,8</strong>
        </span>
      </div>
    </div>
  );
}
