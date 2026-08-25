'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  MessageSquare,
  ShieldAlert,
  UserX,
} from 'lucide-react';

import type { PendingConversation } from '@/core/domain/analytics';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

interface AttentionPanelProps {
  readonly items: readonly PendingConversation[];
}

type FilterTab = 'todos' | 'espera' | 'sem_responsavel' | 'prioridade';

export function AttentionPanel({ items }: AttentionPanelProps) {
  const [tab, setTab] = useState<FilterTab>('todos');

  const filteredItems = useMemo(() => {
    switch (tab) {
      case 'espera':
        return [...items].sort((a, b) => (b.waitingMinutes ?? 0) - (a.waitingMinutes ?? 0));
      case 'sem_responsavel':
        return items.filter((item) => !item.assigneeName);
      case 'prioridade':
        return items.filter(
          (item) => item.priority === 'urgente' || item.priority === 'alta' || item.tone === 'red',
        );
      case 'todos':
      default:
        return items;
    }
  }, [items, tab]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xs">
      {/* Cabeçalho do Painel */}
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4" />
          </div>
          <div>
            <h2 className="font-display text-sm font-bold text-ink">Precisa de atenção</h2>
            <p className="text-[11px] text-muted">Fila prioritária para resposta e triagem</p>
          </div>
        </div>

        {/* Abas de Filtro */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setTab('todos')}
            className={cn(
              'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all',
              tab === 'todos'
                ? 'bg-surface text-ink shadow-2xs font-bold'
                : 'text-muted hover:text-ink',
            )}
          >
            Todos ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('sem_responsavel')}
            className={cn(
              'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all',
              tab === 'sem_responsavel'
                ? 'bg-surface text-amber-600 shadow-2xs font-bold'
                : 'text-muted hover:text-ink',
            )}
          >
            Sem responsável
          </button>
          <button
            type="button"
            onClick={() => setTab('prioridade')}
            className={cn(
              'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all',
              tab === 'prioridade'
                ? 'bg-surface text-red-600 shadow-2xs font-bold'
                : 'text-muted hover:text-ink',
            )}
          >
            Alta prioridade
          </button>
        </div>
      </div>

      {/* Lista de Atendimentos Prioritários */}
      <div className="flex-1 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
              <ShieldAlert className="size-5" />
            </div>
            <p className="font-display text-sm font-semibold text-ink">Nenhuma conversa pendente</p>
            <p className="max-w-xs text-xs text-muted">
              Toda a fila de atendimento está em dia e respondida. Excelente trabalho!
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {filteredItems.map((item) => {
              const isUnassigned = !item.assigneeName;

              return (
                <li
                  key={item.conversationId}
                  className="group relative flex items-center justify-between gap-3 p-3.5 transition-colors hover:bg-surface-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={item.contactName} size="md" />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-bold text-ink">
                          {item.contactName}
                        </span>
                        {item.channel ? (
                          <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[10px] font-semibold text-muted bg-surface-2">
                            {item.channel}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                        <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                          <Clock className="size-3" /> {item.waitingLabel}
                        </span>

                        {isUnassigned ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
                            <UserX className="size-3" /> Sem responsável
                          </span>
                        ) : (
                          <span className="text-dim truncate">
                            Resp: {item.assigneeName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Ação rápida para abrir a conversa */}
                  <Link
                    href={`/conversas/${item.conversationId}` as Route}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-2xs transition-all hover:border-brand hover:bg-brand hover:text-white"
                  >
                    Atender
                    <ArrowRight className="size-3.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Rodapé com link para Inbox */}
      <div className="border-t border-line bg-surface-2/40 p-3 text-center">
        <Link
          href="/conversas"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand transition-colors hover:text-brand/80"
        >
          <MessageSquare className="size-3.5" />
          Ver todas as conversas na Caixa de Entrada
        </Link>
      </div>
    </div>
  );
}
