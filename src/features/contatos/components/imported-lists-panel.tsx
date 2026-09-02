'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Building2, CalendarDays, FolderOpen, Users } from 'lucide-react';
import type { Contact, ContactImportBatchSummary } from '@/core/domain/contact';
import { PhoneNumber } from '@/core/domain/contact';
import { StartConversationButton } from './start-conversation-button';

interface ImportedListsPanelProps {
  readonly batches: readonly ContactImportBatchSummary[];
  readonly contacts: readonly Contact[];
  readonly onImport: () => void;
}

export function ImportedListsPanel({ batches, contacts, onImport }: ImportedListsPanelProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = batches.find((batch) => batch.id === selectedId);
  const contactsById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );
  const selectedContacts = selected
    ? selected.contactIds
        .map((id) => contactsById.get(id))
        .filter((contact): contact is Contact => Boolean(contact))
    : [];

  if (!selected) {
    return batches.length === 0 ? (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface p-12 text-center shadow-xs">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <FolderOpen className="size-7" />
        </div>
        <h3 className="mt-4 font-display text-title font-bold text-ink">Nenhuma lista importada</h3>
        <p className="mt-1 max-w-md text-body text-muted">
          Importe um CSV B2B e dê um nome ao lote para encontrá-lo aqui.
        </p>
        <button
          type="button"
          onClick={onImport}
          className="mt-5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          Importar primeira lista
        </button>
      </div>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {batches.map((batch) => (
          <button
            key={batch.id}
            type="button"
            onClick={() => setSelectedId(batch.id)}
            className="group rounded-2xl border border-line bg-surface p-5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Building2 className="size-5" />
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-line-soft bg-surface-2 px-2 py-1 text-[11px] font-semibold text-muted">
                <Users className="size-3" /> {batch.contactCount}
              </span>
            </div>
            <h3 className="mt-4 truncate font-display text-base font-bold text-ink group-hover:text-brand">
              {batch.name}
            </h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <CalendarDays className="size-3.5" />
              {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(batch.createdAt),
              )}
            </p>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSelectedId(undefined)}
            className="rounded-lg border border-line bg-surface p-2 text-muted hover:text-ink"
            aria-label="Voltar para listas"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div>
            <h2 className="font-display text-lg font-bold text-ink">{selected.name}</h2>
            <p className="text-xs text-muted">
              {selected.contactCount} registro(s) ·{' '}
              {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(
                new Date(selected.createdAt),
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-xs">
            <thead className="border-b border-line bg-surface-2/70 uppercase tracking-wider text-dim">
              <tr>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">Endereço</th>
                <th className="px-4 py-3">Telefone da empresa</th>
                <th className="px-4 py-3">Telefone do sócio</th>
                <th className="px-4 py-3">Classificação</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {selectedContacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-3 font-semibold text-ink">
                    {contact.company ?? contact.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-muted">{contact.cnpj || '—'}</td>
                  <td className="max-w-xs px-4 py-3 text-muted">{contact.companyAddress || '—'}</td>
                  <td className="px-4 py-3 font-mono text-ink">
                    {contact.companyPhone ? PhoneNumber.format(contact.companyPhone) : '—'}
                  </td>
                  {/* A coluna segue mostrando o telefone do sócio principal,
                      como antes. O que muda é o aviso de que há mais: sem ele a
                      tabela sugeria que aquele era o único número da empresa, e
                      quem clicasse em conversar levava um susto com a lista. */}
                  <td className="px-4 py-3 font-mono text-ink">
                    {contact.partnerPhone ? PhoneNumber.format(contact.partnerPhone) : '—'}
                    {(() => {
                      const socios = contact.partners ?? [];
                      const total = socios.reduce((soma, s) => soma + s.phones.length, 0);
                      if (total <= 1) return null;
                      return (
                        <span className="ml-1.5 rounded-md bg-brand/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-brand">
                          {socios.length > 1
                            ? `${socios.length} sócios · ${total} números`
                            : `+${total - 1}`}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {contact.classification ? (
                      <span className="rounded-md border border-line-soft bg-surface-2 px-2 py-1 font-medium text-ink">
                        {contact.classification}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StartConversationButton
                      contact={contact}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-emerald-600 hover:bg-emerald-500/10"
                    >
                      <span>Iniciar conversa</span>
                    </StartConversationButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
