'use client';

import { AlertTriangle } from 'lucide-react';
import type { Deal } from '@/core/domain/pipeline';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PRIORITY_LABEL, PRIORITY_TONE } from '@/components/domain/presentation-maps';
import { formatMoneyFromCents } from '@/lib/format';
import { cn } from '@/lib/cn';

interface DealCardProps {
  readonly deal: Deal;
  readonly stale: boolean;
  readonly dragging: boolean;
  readonly onDragStart: (dealId: string) => void;
  readonly onDragEnd: () => void;
  readonly onOpen: (dealId: string) => void;
}

export function DealCard({
  deal,
  stale,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: DealCardProps) {
  return (
    <li>
      <article
        draggable
        onDragStart={() => onDragStart(deal.id)}
        onDragEnd={onDragEnd}
        className={cn(
          'cursor-grab rounded-surface border border-line bg-surface p-3.5 shadow-2xs transition-all duration-150 hover:shadow-sm hover:border-brand/30 active:cursor-grabbing',
          dragging && 'opacity-50 scale-95',
        )}
      >
        <button type="button" onClick={() => onOpen(deal.id)} className="w-full text-left">
          <header className="flex items-start gap-2.5">
            <Avatar name={deal.contactName} size="xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-ui font-semibold text-ink tracking-tight">
                {deal.contactName}
              </p>
              <p className="truncate text-meta text-dim">{deal.company ?? 'Sem empresa'}</p>
            </div>
            <Badge tone={PRIORITY_TONE[deal.priority]}>{PRIORITY_LABEL[deal.priority]}</Badge>
          </header>

          <p className="mt-2.5 font-display text-title font-bold text-ink tracking-tight tabular-nums">
            {formatMoneyFromCents(deal.amountInCents)}
          </p>
          <p className="mt-1 text-meta text-muted line-clamp-1">{deal.nextAction}</p>

          <footer className="mt-2.5 flex items-center justify-between border-t border-line-soft pt-2 text-meta text-dim">
            <span className="font-medium">{deal.ownerName}</span>
            <span
              className={cn(
                'flex items-center gap-1 font-mono text-meta tabular-nums',
                stale && 'font-semibold text-amber-text',
              )}
            >
              {stale ? <AlertTriangle className="size-3" /> : null}
              {deal.stageAgeLabel}
            </span>
          </footer>
        </button>
      </article>
    </li>
  );
}
