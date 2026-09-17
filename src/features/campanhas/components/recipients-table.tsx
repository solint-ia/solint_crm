'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import type { CampaignRecipient, CampaignRecipientStatus } from '@/core/domain/campaign';
import { CAMPAIGN_RECIPIENT_STATUS_LABELS } from '@/core/domain/campaign';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PhoneNumber } from '@/core/domain/contact';
import { dataHoraLabel } from '@/lib/datetime';

const TONE: Readonly<
  Record<CampaignRecipientStatus, 'slate' | 'blue' | 'green' | 'amber' | 'red'>
> = {
  queued: 'slate',
  sending: 'blue',
  sent: 'blue',
  delivered: 'green',
  read: 'green',
  replied: 'green',
  failed: 'red',
};

type Filtro = 'todos' | 'pendentes' | 'entregues' | 'responderam' | 'falhas';

const filtrar = (recipients: readonly CampaignRecipient[], filtro: Filtro) => {
  switch (filtro) {
    case 'pendentes':
      return recipients.filter((r) => r.status === 'queued' || r.status === 'sending');
    case 'entregues':
      return recipients.filter(
        (r) => r.status === 'delivered' || r.status === 'read' || r.status === 'replied',
      );
    case 'responderam':
      return recipients.filter((r) => r.status === 'replied');
    case 'falhas':
      return recipients.filter((r) => r.status === 'failed');
    default:
      return recipients;
  }
};

/** Cada destinatário e onde ele parou. O erro da Meta aparece por extenso. */
export function RecipientsTable({
  recipients,
}: {
  readonly recipients: readonly CampaignRecipient[];
}) {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const lista = useMemo(() => filtrar(recipients, filtro), [recipients, filtro]);

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-ui font-bold tracking-tight text-ink">
          Destinatários
          <span className="ml-2 font-sans font-normal text-dim">{lista.length}</span>
        </h2>
        <SegmentedControl
          value={filtro}
          onChange={setFiltro}
          ariaLabel="Filtrar destinatários"
          options={[
            { id: 'todos', label: 'Todos' },
            { id: 'pendentes', label: 'Na fila' },
            { id: 'entregues', label: 'Entregues' },
            { id: 'responderam', label: 'Responderam' },
            { id: 'falhas', label: 'Falhas' },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-body">
          <thead className="border-b border-line text-meta tracking-wide text-dim uppercase">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                Contato
              </th>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                Enviado
              </th>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                Detalhe
              </th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-meta text-dim">
                  Nenhum destinatário neste filtro.
                </td>
              </tr>
            ) : null}
            {lista.map((r) => (
              <tr key={r.id} className="border-b border-line-soft last:border-0">
                <td className="px-4 py-2.5">
                  {r.conversationId ? (
                    <Link
                      href={`/conversas/${r.conversationId}` as Route}
                      className="font-semibold text-ink hover:underline"
                    >
                      {r.name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-ink">{r.name}</span>
                  )}
                  <span className="block font-mono text-meta text-dim">
                    {PhoneNumber.format(r.phone) || r.phone}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={TONE[r.status]} withDot>
                    {CAMPAIGN_RECIPIENT_STATUS_LABELS[r.status]}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {r.sentAt ? dataHoraLabel(new Date(r.sentAt)) : '—'}
                </td>
                <td className="px-4 py-2.5 text-meta text-muted">
                  {r.error
                    ? r.error
                    : r.repliedAt
                      ? `Respondeu ${dataHoraLabel(new Date(r.repliedAt))}`
                      : r.readAt
                        ? `Lido ${dataHoraLabel(new Date(r.readAt))}`
                        : r.deliveredAt
                          ? `Entregue ${dataHoraLabel(new Date(r.deliveredAt))}`
                          : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
