'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  FolderOpen,
  Loader2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { Contact, ContactImportBatchSummary } from '@/core/domain/contact';
import { PhoneNumber } from '@/core/domain/contact';
import {
  deleteImportBatchAction,
  removeContactFromBatchAction,
} from '@/app/(workspace)/contatos/actions';
import { useToast } from '@/components/ui/toast';
import { StartConversationButton } from './start-conversation-button';

interface ImportedListsPanelProps {
  readonly batches: readonly ContactImportBatchSummary[];
  readonly contacts: readonly Contact[];
  readonly onImport: () => void;
}

export function ImportedListsPanel({ batches, contacts, onImport }: ImportedListsPanelProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const [confirmando, setConfirmando] = useState<string>();
  const [pendente, setPendente] = useState<string>();
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { show } = useToast();

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

  /**
   * Apagar a lista devolve à galeria antes de recarregar.
   *
   * Sem isso a tela ficaria olhando para um lote que o servidor acabou de
   * apagar, e o `router.refresh()` a esvaziaria por baixo — o usuário veria uma
   * tabela vazia com o nome da lista no topo, sem entender se deu certo.
   */
  const apagarLista = (batchId: string, nome: string) => {
    setPendente(batchId);
    startTransition(async () => {
      const resultado = await deleteImportBatchAction({ batchId });
      setPendente(undefined);
      setConfirmando(undefined);
      if (!resultado.ok) {
        show({
          tone: 'erro',
          title: 'Não foi possível excluir',
          description: resultado.error ?? 'Tente de novo em instantes.',
        });
        return;
      }
      setSelectedId(undefined);
      show({
        tone: 'sucesso',
        title: `Lista “${nome}” excluída`,
        description: 'Os contatos continuam na aba de contatos individuais.',
      });
      router.refresh();
    });
  };

  const removerEmpresa = (batchId: string, contactId: string, nome: string) => {
    setPendente(contactId);
    startTransition(async () => {
      const resultado = await removeContactFromBatchAction({ batchId, contactId });
      setPendente(undefined);
      if (!resultado.ok) {
        show({
          tone: 'erro',
          title: 'Não foi possível remover',
          description: resultado.error ?? 'Tente de novo em instantes.',
        });
        return;
      }
      show({
        tone: 'sucesso',
        title: `${nome} saiu da lista`,
        description: 'O contato continua na aba de contatos individuais.',
      });
      router.refresh();
    });
  };

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
          <div
            key={batch.id}
            className="group relative rounded-2xl border border-line bg-surface shadow-xs transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
          >
            <button
              type="button"
              onClick={() => setSelectedId(batch.id)}
              className="w-full p-5 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <Building2 className="size-5" />
                </div>
                {/* O contador cede o canto ao botão de excluir no hover: os dois
                    disputam o mesmo lugar, e o número é a informação que já foi
                    lida quando a mão chega ali. */}
                <span className="inline-flex items-center gap-1 rounded-full border border-line-soft bg-surface-2 px-2 py-1 text-[11px] font-semibold text-muted transition-opacity group-hover:opacity-0">
                  <Users className="size-3" /> {batch.contactCount}
                </span>
              </div>
              <h3 className="mt-4 truncate font-display text-base font-bold text-ink group-hover:text-brand">
                {batch.name}
              </h3>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <CalendarDays className="size-3.5" />
                {new Intl.DateTimeFormat('pt-BR', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(batch.createdAt))}
              </p>
            </button>

            <button
              type="button"
              onClick={() => setConfirmando(batch.id)}
              aria-label={`Excluir a lista ${batch.name}`}
              className="absolute right-4 top-4 rounded-lg p-2 text-dim opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-4" />
            </button>

            {confirmando === batch.id ? (
              <div className="absolute inset-0 flex flex-col justify-center gap-3 rounded-2xl border border-rose-500/40 bg-surface p-5">
                <p className="text-xs text-ink">
                  Excluir <strong>{batch.name}</strong>?
                </p>
                {/* A frase existe porque o botão mente sem ela: "excluir lista"
                    soa como excluir o que está dentro dela. */}
                <p className="text-[11px] leading-relaxed text-muted">
                  Some só o agrupamento. As {batch.contactCount} empresas continuam na aba de
                  contatos individuais, com as conversas delas.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pendente === batch.id}
                    onClick={() => apagarLista(batch.id, batch.name)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {pendente === batch.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Excluir lista
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmando(undefined)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : null}
          </div>
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

        {confirmando === selected.id ? (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/5 px-3 py-2">
            <span className="text-xs text-ink">Excluir a lista? Os contatos permanecem.</span>
            <button
              type="button"
              disabled={pendente === selected.id}
              onClick={() => apagarLista(selected.id, selected.name)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {pendente === selected.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(undefined)}
              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(selected.id)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-rose-500/40 hover:text-rose-600"
          >
            <Trash2 className="size-3.5" />
            Excluir lista
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] text-left text-xs">
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
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <StartConversationButton
                        contact={contact}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-emerald-600 hover:bg-emerald-500/10"
                      >
                        <span>Iniciar conversa</span>
                      </StartConversationButton>
                      {/* Um clique só, e sem confirmação: tirar da lista não
                          destrói nada — o contato fica na aba individual, e
                          reimportar a planilha o traz de volta. */}
                      <button
                        type="button"
                        disabled={pendente === contact.id}
                        onClick={() =>
                          removerEmpresa(
                            selected.id,
                            contact.id,
                            contact.company ?? contact.name,
                          )
                        }
                        aria-label={`Tirar ${contact.company ?? contact.name} desta lista`}
                        title="Tirar desta lista (o contato continua no CRM)"
                        className="rounded-lg p-1.5 text-dim transition-colors hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-50"
                      >
                        {pendente === contact.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <X className="size-3.5" />
                        )}
                      </button>
                    </div>
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
