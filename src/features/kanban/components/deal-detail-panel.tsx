'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import type { Deal } from '@/core/domain/pipeline';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PRIORITY_LABEL, PRIORITY_TONE } from '@/components/domain/presentation-maps';
import { formatMoneyFromCents } from '@/lib/format';

interface DealDetailPanelProps {
  readonly deal: Deal;
  readonly stageName: string;
  readonly onClose: () => void;
}

export function DealDetailPanel({ deal, stageName, onClose }: DealDetailPanelProps) {
  return (
    <aside
      aria-label={`Detalhes da oportunidade de ${deal.contactName}`}
      className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface"
    >
      <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-4">
        <div className="flex items-center gap-2.5">
          <Avatar name={deal.contactName} size="md" />
          <div>
            <p className="font-display text-ui font-semibold text-ink">{deal.contactName}</p>
            <p className="text-meta text-muted">{deal.company ?? 'Sem empresa'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar detalhes"
          className="rounded-control p-1 text-dim hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </header>

      <section className="border-b border-line px-4 py-3">
        <p className="font-display text-metric font-semibold text-ink">
          {formatMoneyFromCents(deal.amountInCents)}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone="slate">{stageName}</Badge>
          <Badge tone={PRIORITY_TONE[deal.priority]}>{PRIORITY_LABEL[deal.priority]}</Badge>
          <Badge tone="blue">{deal.ownerName}</Badge>
        </div>
      </section>

      <section className="border-b border-line px-4 py-3">
        <h3 className="mb-1.5 text-meta font-semibold tracking-wide text-dim uppercase">
          Próxima ação
        </h3>
        <p className="text-body text-ink">{deal.nextAction}</p>
      </section>

      <section className="border-b border-line px-4 py-3">
        <h3 className="mb-2 text-meta font-semibold tracking-wide text-dim uppercase">
          Histórico
        </h3>
        <ul className="flex flex-col gap-2.5">
          {deal.history.map((entry) => (
            <li key={`${entry.date}-${entry.text}`} className="border-l-2 border-line pl-2.5">
              <p className="text-body text-ink">{entry.text}</p>
              <p className="text-meta text-dim">{entry.date}</p>
            </li>
          ))}
        </ul>
      </section>

      {deal.conversationId ? (
        <div className="px-4 py-3">
          <Link href="/conversas">
            <Button variant="secondary" fullWidth size="sm">
              Abrir conversa de origem
            </Button>
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
