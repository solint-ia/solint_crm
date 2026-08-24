'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Bookmark, Download, Plus, Search, Upload } from 'lucide-react';
import type { Contact } from '@/core/domain/contact';
import { PhoneNumber } from '@/core/domain/contact';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { LabelChips } from '@/components/domain/label-chip';
import { ImportCsvModal } from './import-csv-modal';
import {
  createContactAction,
  saveSegmentAction,
} from '@/app/(workspace)/contatos/actions';

/** Lista de contatos com busca, selecao multipla e ações em massa. */
export function ContactsExplorer({ contacts }: { readonly contacts: readonly Contact[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  // Modal Novo Contato
  const [isNewContactOpen, setIsNewContactOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);

  // Modal Salvar Segmento
  const [isSegmentOpen, setIsSegmentOpen] = useState(false);
  const [segmentName, setSegmentName] = useState('');
  const [segmentDescription, setSegmentDescription] = useState('');
  const [segmentFeedback, setSegmentFeedback] = useState<string | null>(null);

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

  const handleCreateContact = (e: React.FormEvent) => {
    e.preventDefault();
    setContactError(null);
    startTransition(async () => {
      const res = await createContactAction({
        name,
        phone,
        email: email || undefined,
        company: company || undefined,
        notes: notes || undefined,
      });
      if (res.ok) {
        setIsNewContactOpen(false);
        setName('');
        setPhone('');
        setEmail('');
        setCompany('');
        setNotes('');
        router.refresh();
      } else {
        setContactError(res.error ?? 'Erro ao criar contato.');
      }
    });
  };

  const handleSaveSegment = (e: React.FormEvent) => {
    e.preventDefault();
    setSegmentFeedback(null);
    startTransition(async () => {
      const res = await saveSegmentAction({
        name: segmentName,
        description: segmentDescription || undefined,
        filters: [{ field: 'search', operator: 'contains', value: search }],
        contactCount: visible.length,
      });
      if (res.ok) {
        setSegmentFeedback('Segmento salvo com sucesso!');
        setTimeout(() => {
          setIsSegmentOpen(false);
          setSegmentName('');
          setSegmentDescription('');
          setSegmentFeedback(null);
        }, 1200);
      } else {
        setSegmentFeedback(res.error ?? 'Erro ao salvar segmento.');
      }
    });
  };

  const handleExportCsv = () => {
    const rows = [
      ['Nome', 'Telefone', 'Email', 'Empresa', 'Ultimo Contato', 'Responsavel'],
      ...visible.map((c) => [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.phone}"`,
        `"${(c.email ?? '').replace(/"/g, '""')}"`,
        `"${(c.company ?? '').replace(/"/g, '""')}"`,
        `"${c.lastContactLabel ?? ''}"`,
        `"${c.ownerName ?? ''}"`,
      ]),
    ];

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `contatos_solint_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      {/* Modal Novo Contato */}
      <Modal
        open={isNewContactOpen}
        onClose={() => setIsNewContactOpen(false)}
        title="Cadastrar novo contato"
      >
        <form onSubmit={handleCreateContact} className="flex flex-col gap-4">
          {contactError && (
            <div className="rounded-md bg-danger/10 p-3 text-body text-danger">
              {contactError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Nome completo</label>
            <input
              type="text"
              required
              placeholder="Ex: João da Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Telefone / WhatsApp (E.164)</label>
            <input
              type="tel"
              required
              placeholder="+5511999998888"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">E-mail</label>
              <input
                type="email"
                placeholder="cliente@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Empresa</label>
              <input
                type="text"
                placeholder="Empresa XYZ"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Anotações iniciais</label>
            <textarea
              rows={3}
              placeholder="Detalhes ou histórico deste cliente..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsNewContactOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !name.trim() || !phone.trim()}>
              {isPending ? 'Salvando...' : 'Salvar contato'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Salvar Segmento */}
      <Modal
        open={isSegmentOpen}
        onClose={() => setIsSegmentOpen(false)}
        title="Salvar segmento inteligente"
      >
        <form onSubmit={handleSaveSegment} className="flex flex-col gap-4">
          {segmentFeedback && (
            <div className="rounded-md bg-accent-soft p-3 text-body text-accent-soft-text">
              {segmentFeedback}
            </div>
          )}
          <p className="text-body text-muted">
            Este segmento agrupará dinamicamente os contatos que atendem aos filtros atuais ({visible.length} contatos encontrados).
          </p>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Nome do segmento</label>
            <input
              type="text"
              required
              placeholder="Ex: Clientes VIP São Paulo"
              value={segmentName}
              onChange={(e) => setSegmentName(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Descrição (opcional)</label>
            <input
              type="text"
              placeholder="Finalidade deste agrupamento..."
              value={segmentDescription}
              onChange={(e) => setSegmentDescription(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsSegmentOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !segmentName.trim()}>
              {isPending ? 'Salvando...' : 'Salvar segmento'}
            </Button>
          </div>
        </form>
      </Modal>

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

        <Button
          variant="secondary"
          size="md"
          icon={<Bookmark className="size-3.5" />}
          onClick={() => setIsSegmentOpen(true)}
        >
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
        <Button
          variant="secondary"
          size="md"
          icon={<Download className="size-3.5" />}
          onClick={handleExportCsv}
        >
          Exportar
        </Button>
        <Button
          size="md"
          icon={<Plus className="size-3.5" />}
          onClick={() => setIsNewContactOpen(true)}
        >
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
          action={<Button size="sm" onClick={() => setIsNewContactOpen(true)}>Criar novo contato</Button>}
        />
      )}

      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

