'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Bookmark, Download, Plus, Search, Upload } from 'lucide-react';
import type { Contact } from '@/core/domain/contact';
import { PhoneNumber } from '@/core/domain/contact';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LabelChips } from '@/components/domain/label-chip';
import { ImportCsvModal } from './import-csv-modal';
import { planned } from '@/components/ui/planned';

/** Lista de contatos com busca, selecao multipla e ações em massa. */
export function ContactsExplorer({ contacts }: { readonly contacts: readonly Contact[] }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter((contact) =>
      [contact.name, contact.email ?? '', contact.company ?? '', contact.phone]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [contacts, search]);

  const allSelected = visible.length > 0 && selected.length === visible.length;

  const toggleAll = () =>
    setSelected(allSelected ? [] : visible.map((contact) => contact.id));

  const toggleOne = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-dim" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, telefone, e-mail ou empresa"
            aria-label="Buscar contatos"
            className="h-10 w-full rounded-control border border-line bg-surface pr-3 pl-8 text-ui text-ink outline-none placeholder:text-dim focus:border-brand"
          />
        </div>

        <Button variant="secondary" size="md" icon={<Bookmark className="size-3.5" />} {...planned('Salvar o filtro atual como segmento')}>
          Salvar segmento
        </Button>
        <Button
          variant="secondary"
          size="md"
          icon={<Upload className="size-3.5" />}
          onClick={() => setImportOpen(true)}
        >
          Importar CSV
        </Button>
        <Button variant="secondary" size="md" icon={<Download className="size-3.5" />} {...planned('Exportar os contatos filtrados em CSV')}>
          Exportar
        </Button>
        <Button size="md" icon={<Plus className="size-3.5" />} {...planned('Cadastrar um contato manualmente')}>
          Novo contato
        </Button>
      </div>

      {selected.length > 0 ? (
        <p className="mb-3 rounded-control border border-accent-line bg-selected px-3 py-2 text-body text-ink">
          {selected.length} contato(s) selecionado(s) · ações em massa: aplicar etiqueta, exportar,
          adicionar a campanha.
        </p>
      ) : null}

      {visible.length > 0 ? (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-body">
            <caption className="sr-only">Base de contatos da conta</caption>
            <thead className="border-b border-line text-meta tracking-wide text-dim uppercase">
              <tr>
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Selecionar todos os contatos"
                  />
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Nome</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Telefone</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Empresa</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Etiquetas</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Último contato</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Responsável</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((contact) => (
                <tr key={contact.id} className="border-b border-line-soft last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(contact.id)}
                      onChange={() => toggleOne(contact.id)}
                      aria-label={`Selecionar ${contact.name}`}
                    />
                  </td>
                  <th scope="row" className="px-4 py-2.5 font-normal">
                    <Link
                      href={`/contatos/${contact.id}` as Route}
                      className="flex items-center gap-2 text-ink hover:text-brand"
                    >
                      <Avatar name={contact.name} tone={contact.avatarTone} size="xs" />
                      <span>
                        <span className="block font-semibold">{contact.name}</span>
                        <span className="block text-meta text-dim">{contact.email}</span>
                      </span>
                    </Link>
                  </th>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-muted">
                    {PhoneNumber.format(contact.phone)}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{contact.company ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <LabelChips labels={contact.labels} />
                  </td>
                  <td className="px-4 py-2.5 text-muted">{contact.lastContactLabel ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted">{contact.ownerName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState
          title="Nenhum contato corresponde ao filtro"
          description="Ajuste a busca ou cadastre um novo contato para começar."
          action={<Button size="sm" {...planned('Cadastrar um contato manualmente')}>Criar novo contato</Button>}
        />
      )}

      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
