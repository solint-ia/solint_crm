import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight } from 'lucide-react';
import type { PendingConversation } from '@/core/domain/analytics';
import { Avatar } from '@/components/ui/avatar';
import { EmptyHint } from '@/components/ui/empty-state';
import { TONE_TEXT_CLASSES } from '@/components/ui/tone';

/**
 * Faixa 2 do dashboard: o que precisa de atenção.
 *
 * Cada linha leva direto ao atendimento — uma lista de pendências que não abre
 * a conversa obriga o operador a procurá-la de novo na caixa de entrada, e o
 * tempo que ela reporta continua correndo enquanto ele procura.
 */
export function AttentionList({ items }: { readonly items: readonly PendingConversation[] }) {
  if (items.length === 0) {
    return <EmptyHint>Nenhuma conversa aguardando resposta. Fila em dia.</EmptyHint>;
  }

  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.conversationId} className="border-b border-line-soft last:border-0">
          <Link
            href={`/conversas/${item.conversationId}` as Route}
            className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-surface-2"
          >
            <Avatar name={item.contactName} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-ink">
                {item.contactName}
              </span>
              <span className="block text-meta text-dim">aguardando resposta</span>
            </span>
            <span
              className={`shrink-0 font-mono text-body font-semibold tabular-nums ${TONE_TEXT_CLASSES[item.tone]}`}
            >
              {item.waitingLabel}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-dim transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
