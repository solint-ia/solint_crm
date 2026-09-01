'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Kanban,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import type { Contact } from '@/core/domain/contact';
import { PhoneNumber, isGroupAllowedInChat } from '@/core/domain/contact';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { FloatingDropdown } from '@/components/ui/floating-dropdown';
import { LabelChips } from '@/components/domain/label-chip';
import { useToast } from '@/components/ui/toast';

import { ContactDrawer } from './contact-drawer';
import { NewContactModal } from './new-contact-modal';
import { EditContactModal } from './edit-contact-modal';
import { StartConversationButton } from './start-conversation-button';
import { SaveSegmentModal } from './save-segment-modal';
import { ImportCsvModal } from './import-csv-modal';
import {
  auditContactsExportAction,
  deleteContactAction,
  deleteContactsAction,
  syncWhatsAppContactsAction,
  syncWhatsAppGroupsAction,
  toggleGroupChatAction,
} from '@/app/(workspace)/contatos/actions';
import { cn } from '@/lib/cn';

type ContactTab = 'todos' | 'pessoas' | 'grupos';
type SortField = 'name' | 'phone' | 'company' | 'lastContactAt' | 'ownerName';
type SortOrder = 'asc' | 'desc';

interface ContactsExplorerProps {
  readonly contacts: readonly Contact[];
  /**
   * `contatos:exportar` já existia no tipo e nunca era conferida — o botão
   * saía para todo mundo que abrisse a tela. Resolvida no servidor porque este
   * é componente de cliente; a lista já sai da máquina de qualquer forma, então
   * a permissão aqui é sobre o atalho de baixar tudo de uma vez.
   */
  readonly canExport: boolean;
}

/** Quantos contatos a tabela desenha por vez. */
const CONTACTS_PER_PAGE = 50;

export function ContactsExplorer({ contacts, canExport }: ContactsExplorerProps) {
  const router = useRouter();
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  // Aba selecionada (Todos / Pessoas / Grupos)
  const [tab, setTab] = useState<ContactTab>('todos');

  // Estados de Busca e Filtro
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Seleção Múltipla
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [page, setPage] = useState(1);

  /**
   * Filtrar ou buscar volta para a primeira página.
   *
   * Continuar na página 4 depois de trocar o filtro mostraria um pedaço do meio
   * de uma lista que a pessoa nunca viu começar.
   */
  const trocarTab = (nova: ContactTab) => {
    setTab(nova);
    setPage(1);
  };

  // Modais e Drawer
  const [isNewContactOpen, setIsNewContactOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSegmentOpen, setIsSegmentOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [selectedDrawerContact, setSelectedDrawerContact] = useState<Contact | null>(null);

  // Modais de Confirmação de Exclusão
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);

  // Menu de Ações por Linha (dropdown aberto)
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  /** Onde o menu aberto deve se ancorar — o retângulo do botão que o abriu. */
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  // Estados de Operação com Grupos
  const [togglingGroupId, setTogglingGroupId] = useState<string | null>(null);
  const [isSyncingGroups, setIsSyncingGroups] = useState(false);

  // Contadores por Aba
  const tabCounts = useMemo(() => ({
    todos: contacts.length,
    pessoas: contacts.filter((c) => c.kind !== 'grupo').length,
    grupos: contacts.filter((c) => c.kind === 'grupo').length,
  }), [contacts]);

  // Filtro de Busca Multicampos (Nome, Telefone, E-mail, Empresa, Etiquetas)
  const filteredContacts = useMemo(() => {
    let list = contacts;
    if (tab === 'pessoas') {
      list = contacts.filter((c) => c.kind !== 'grupo');
    } else if (tab === 'grupos') {
      list = contacts.filter((c) => c.kind === 'grupo');
    }

    const term = search.trim().toLowerCase();
    if (!term) return list;

    return list.filter((contact) => {
      const nameMatch = contact.name.toLowerCase().includes(term);
      const phoneMatch =
        contact.phone.toLowerCase().includes(term) ||
        (contact.extraPhones ?? []).some((numero) => numero.toLowerCase().includes(term));
      const emailMatch = contact.email?.toLowerCase().includes(term) ?? false;
      const companyMatch = contact.company?.toLowerCase().includes(term) ?? false;
      const labelsMatch = contact.labels.some((l) => l.name.toLowerCase().includes(term));
      const ownerMatch = contact.ownerName?.toLowerCase().includes(term) ?? false;

      return nameMatch || phoneMatch || emailMatch || companyMatch || labelsMatch || ownerMatch;
    });
  }, [contacts, tab, search]);

  // Ordenação Interativa
  const sortedContacts = useMemo(() => {
    return [...filteredContacts].sort((a, b) => {
      let valA = (a[sortField] ?? '').toString().toLowerCase();
      let valB = (b[sortField] ?? '').toString().toLowerCase();

      if (sortField === 'lastContactAt') {
        valA = a.lastContactAt ?? '';
        valB = b.lastContactAt ?? '';
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredContacts, sortField, sortOrder]);

  /**
   * Paginação: a tabela desenha 50 por vez.
   *
   * A lista inteira continua vindo do servidor de uma vez — o filtro, a busca e
   * a ordenação precisam dela toda para responder certo, e paginar no banco
   * faria "ordenar por último contato" ordenar só os 50 da página atual. O que
   * muda é quantas linhas o navegador desenha: uma base de milhares de contatos
   * montava milhares de `<tr>`, e era isso que travava a rolagem.
   */
  const totalPages = Math.max(1, Math.ceil(sortedContacts.length / CONTACTS_PER_PAGE));

  /**
   * A página nunca fica além do fim.
   *
   * Estar na página 7 e digitar uma busca que devolve 12 resultados deixaria a
   * tabela vazia, com a paginação dizendo "página 7 de 1". Em vez de um
   * `useEffect` que corrige depois de pintar a tela errada, a página é
   * grampeada no próprio cálculo — a tela nunca chega a existir errada.
   */
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * CONTACTS_PER_PAGE;
  const pagedContacts = sortedContacts.slice(pageStart, pageStart + CONTACTS_PER_PAGE);

  // "Selecionar todos" vale para a página à vista, não para a base inteira:
  // marcar uma caixinha não deveria alcançar 3 mil contatos que não estão na
  // tela — sobretudo quando o botão ao lado é "Excluir selecionados".
  const allSelected =
    pagedContacts.length > 0 && pagedContacts.every((c) => selected.includes(c.id));

  const toggleSelectAll = () => {
    const idsDaPagina = pagedContacts.map((c) => c.id);
    if (allSelected) {
      setSelected((prev) => prev.filter((id) => !idsDaPagina.includes(id)));
    } else {
      setSelected((prev) => [...new Set([...prev, ...idsDaPagina])]);
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Exclusão Individual
  const handleConfirmDeleteSingle = async () => {
    if (!contactToDelete) return;
    const contact = contactToDelete;
    setContactToDelete(null);

    startTransition(async () => {
      const res = await deleteContactAction({ contactId: contact.id });
      if (res.ok) {
        show({
          tone: 'sucesso',
          title: 'Contato excluído',
          description: `${contact.name} foi removido da base.`,
        });
        setSelected((prev) => prev.filter((id) => id !== contact.id));
        if (selectedDrawerContact?.id === contact.id) {
          setSelectedDrawerContact(null);
        }
        router.refresh();
      } else {
        show({
          tone: 'erro',
          title: 'Erro ao excluir contato',
          description: res.error,
        });
      }
    });
  };

  // Exclusão em Massa
  const handleConfirmBulkDelete = async () => {
    const toDeleteIds = [...selected];
    setIsBulkDeleteOpen(false);
    setSelected([]);

    startTransition(async () => {
      const result = await deleteContactsAction({ contactIds: toDeleteIds });
      const count = result.data?.count ?? 0;

      show({
        tone: result.ok ? 'sucesso' : 'erro',
        title: result.ok ? 'Contatos excluídos' : 'Erro ao excluir contatos',
        description: result.ok
          ? `${count} contato(s) foram excluídos da base.`
          : result.error,
      });
      router.refresh();
    });
  };

  // Exportação CSV otimizada com Blob nativo e UTF-8 BOM
  const handleExportCsv = async (onlySelected = false) => {
    const listToExport = onlySelected
      ? sortedContacts.filter((c) => selected.includes(c.id))
      : sortedContacts;

    if (listToExport.length === 0) {
      show({
        tone: 'alerta',
        title: 'Nenhum contato',
        description: 'Não há contatos disponíveis para exportação.',
      });
      return;
    }

    const audit = await auditContactsExportAction({ count: listToExport.length });
    if (!audit.ok) {
      show({ tone: 'erro', title: 'Exportação bloqueada', description: audit.error });
      return;
    }

    const escapeCsv = (val: string | null | undefined): string => {
      const str = (val ?? '').toString();
      if (
        str.includes(',') ||
        str.includes(';') ||
        str.includes('"') ||
        str.includes('\n') ||
        str.includes('\r')
      ) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      'Nome',
      'Telefone',
      'Email',
      'Empresa',
      'Etiquetas',
      'Ultimo Contato',
      'Responsavel',
    ];
    const rows = listToExport.map((c) => [
      escapeCsv(c.name),
      escapeCsv(c.phone),
      escapeCsv(c.email),
      escapeCsv(c.company),
      escapeCsv(c.labels.map((l) => l.name).join('; ')),
      escapeCsv(c.lastContactLabel),
      escapeCsv(c.ownerName),
    ]);

    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `contatos_solint_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    show({
      tone: 'sucesso',
      title: 'Exportação concluída',
      description: `${listToExport.length} contato(s) exportado(s) com sucesso em formato CSV.`,
    });
  };

  const [isSyncingWa, setIsSyncingWa] = useState(false);

  const handleSyncWhatsApp = async () => {
    setIsSyncingWa(true);
    try {
      const res = await syncWhatsAppContactsAction();
      if (!res.ok || !res.data) {
        show({
          tone: 'erro',
          title: 'Erro ao sincronizar',
          description: res.error ?? 'Falha ao sincronizar contatos do WhatsApp.',
        });
        return;
      }

      show({
        tone: 'sucesso',
        title: 'Sincronização concluída',
        description: `${res.data.syncedCount} contato(s) do WhatsApp sincronizados e atualizados na base.`,
      });
      router.refresh();
    } catch {
      show({
        tone: 'erro',
        title: 'Erro inesperado',
        description: 'Não foi possível completar a sincronização do WhatsApp.',
      });
    } finally {
      setIsSyncingWa(false);
    }
  };

  const handleToggleGroup = async (contact: Contact, currentAllowed: boolean) => {
    setTogglingGroupId(contact.id);
    try {
      const nextAllowed = !currentAllowed;
      const res = await toggleGroupChatAction({ contactId: contact.id, allowed: nextAllowed });
      if (!res.ok) {
        show({
          tone: 'erro',
          title: 'Erro ao alterar grupo',
          description: res.error ?? 'Não foi possível alterar a autorização do grupo.',
        });
        return;
      }
      show({
        tone: 'sucesso',
        title: nextAllowed ? 'Grupo autorizado no chat' : 'Grupo desativado do chat',
        description: nextAllowed
          ? `O grupo "${contact.name}" agora receberá mensagens e aparecerá na tela de conversas.`
          : `O grupo "${contact.name}" foi desativado e não gravará novas mensagens.`,
      });
      router.refresh();
    } catch {
      show({
        tone: 'erro',
        title: 'Erro inesperado',
        description: 'Falha ao atualizar o status do grupo.',
      });
    } finally {
      setTogglingGroupId(null);
    }
  };

  const handleSyncGroups = async () => {
    setIsSyncingGroups(true);
    try {
      const res = await syncWhatsAppGroupsAction();
      if (!res.ok || !res.data) {
        show({
          tone: 'erro',
          title: 'Erro ao sincronizar grupos',
          description: res.error ?? 'Falha ao sincronizar grupos do WhatsApp.',
        });
        return;
      }
      show({
        tone: 'sucesso',
        title: 'Grupos sincronizados',
        description: `${res.data.syncedCount} grupo(s) detectado(s), ${res.data.newCount} novo(s) adicionado(s) para sua revisão.`,
      });
      router.refresh();
    } catch {
      show({
        tone: 'erro',
        title: 'Erro inesperado',
        description: 'Não foi possível completar a sincronização de grupos.',
      });
    } finally {
      setIsSyncingGroups(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 animate-in fade-in duration-150">
        {/* ============================================================ */}
        {/* ABAS SEGMENTADAS (Todos / Individuais / Grupos)               */}
        {/* ============================================================ */}
        <div className="flex items-center gap-1.5 border-b border-line pb-2">
          <button
            type="button"
            onClick={() => trocarTab('todos')}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all',
              tab === 'todos'
                ? 'bg-brand/12 text-brand border border-brand/30 shadow-xs'
                : 'text-muted hover:text-ink hover:bg-surface-2',
            )}
          >
            <span>Todos os contatos</span>
            <span className={cn(
              'rounded-full px-1.5 py-0.2 text-[10px] font-bold',
              tab === 'todos' ? 'bg-brand text-white' : 'bg-surface-2 text-dim border border-line-soft',
            )}>
              {tabCounts.todos}
            </span>
          </button>

          <button
            type="button"
            onClick={() => trocarTab('pessoas')}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all',
              tab === 'pessoas'
                ? 'bg-brand/12 text-brand border border-brand/30 shadow-xs'
                : 'text-muted hover:text-ink hover:bg-surface-2',
            )}
          >
            <User className="size-3.5" />
            <span>Contatos individuais</span>
            <span className={cn(
              'rounded-full px-1.5 py-0.2 text-[10px] font-bold',
              tab === 'pessoas' ? 'bg-brand text-white' : 'bg-surface-2 text-dim border border-line-soft',
            )}>
              {tabCounts.pessoas}
            </span>
          </button>

          <button
            type="button"
            onClick={() => trocarTab('grupos')}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all',
              tab === 'grupos'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-xs'
                : 'text-muted hover:text-ink hover:bg-surface-2',
            )}
          >
            <Users className="size-3.5" />
            <span>Grupos do WhatsApp</span>
            <span className={cn(
              'rounded-full px-1.5 py-0.2 text-[10px] font-bold',
              tab === 'grupos' ? 'bg-emerald-600 text-white' : 'bg-surface-2 text-dim border border-line-soft',
            )}>
              {tabCounts.grupos}
            </span>
          </button>
        </div>

        {/* Banner Informativo da Aba de Grupos */}
        {tab === 'grupos' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-2xs">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Users className="size-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-ink">Gestão e Autorização de Grupos no Chat</h4>
                <p className="text-xs text-muted mt-0.5">
                  Selecione quais grupos têm permissão para interagir e gravar mensagens no chat do CRM. Grupos desativados são ignorados e não poluem o banco nem a caixa de entrada.
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={
                isSyncingGroups ? (
                  <Loader2 className="size-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <MessageSquare className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                )
              }
              onClick={handleSyncGroups}
              disabled={isSyncingGroups}
              className="shrink-0 font-medium"
            >
              {isSyncingGroups ? 'Buscando grupos...' : 'Buscar grupos do WhatsApp'}
            </Button>
          </div>
        )}

        {/* ============================================================ */}
        {/* BARRA DE FERRAMENTAS PRINCIPAL (Search + Actions)            */}
        {/* ============================================================ */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Campo Amplo de Busca */}
          <div className="relative flex-1 max-w-xl">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-dim" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar por nome, telefone, e-mail ou empresa..."
              aria-label="Buscar contatos"
              className="h-10 w-full rounded-xl border border-line bg-surface pr-9 pl-10 text-body text-ink placeholder:text-dim outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Limpar busca"
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-0.5 text-dim hover:text-ink hover:bg-surface-2 transition-colors"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Botões de Ação */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              icon={
                isSyncingWa ? (
                  <Loader2 className="size-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <MessageSquare className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                )
              }
              onClick={handleSyncWhatsApp}
              disabled={isSyncingWa}
              title="Importar e sincronizar contatos de todos os canais de WhatsApp conectados"
            >
              <span className="hidden lg:inline">
                {isSyncingWa ? 'Sincronizando...' : 'Sincronizar WhatsApp'}
              </span>
              <span className="lg:hidden">
                {isSyncingWa ? 'Sincronizando...' : 'WhatsApp'}
              </span>
            </Button>

            <Button
              variant="secondary"
              size="md"
              icon={<Bookmark className="size-3.5" />}
              onClick={() => setIsSegmentOpen(true)}
              title="Salvar filtro atual como segmento inteligente"
            >
              <span className="hidden md:inline">Salvar segmento</span>
              <span className="md:hidden">Segmento</span>
            </Button>

            <Button
              variant="secondary"
              size="md"
              icon={<Upload className="size-3.5" />}
              onClick={() => setIsImportOpen(true)}
            >
              <span className="hidden md:inline">Importar CSV</span>
              <span className="md:hidden">Importar</span>
            </Button>

            {canExport ? (
              <Button
                variant="secondary"
                size="md"
                icon={<Download className="size-3.5" />}
                onClick={() => handleExportCsv(false)}
              >
                Exportar
              </Button>
            ) : null}

            <Button
              variant="primary"
              size="md"
              icon={<Plus className="size-4" />}
              onClick={() => setIsNewContactOpen(true)}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md shadow-blue-500/20"
            >
              Novo contato
            </Button>
          </div>
        </div>

        {/* ============================================================ */}
        {/* BARRA DE SELEÇÃO EM MASSA (Bulk Action Bar)                  */}
        {/* ============================================================ */}
        {selected.length > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-brand/30 bg-brand/10 dark:bg-brand/15 px-4 py-2.5 shadow-sm animate-in slide-in-from-top-1 duration-150">
            <div className="flex items-center gap-3">
              <span className="flex size-6 items-center justify-center rounded-md bg-brand text-white text-micro font-bold">
                {selected.length}
              </span>
              <span className="text-body font-semibold text-brand">
                {selected.length} {selected.length === 1 ? 'contato selecionado' : 'contatos selecionados'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {canExport ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download className="size-3.5" />}
                  onClick={() => handleExportCsv(true)}
                >
                  Exportar selecionados
                </Button>
              ) : null}

              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => setIsBulkDeleteOpen(true)}
              >
                Excluir
              </Button>

              <button
                type="button"
                onClick={() => setSelected([])}
                aria-label="Limpar seleção"
                className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink transition-colors ml-1"
                title="Desmarcar todos"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TABELA DE CONTATOS MODERNA B2B                               */}
        {/* ============================================================ */}
        {contacts.length === 0 ? (
          /* Estado Vazio Total */
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface p-12 text-center shadow-xs">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-brand/10 border border-brand/20 text-brand shadow-sm">
              <Users className="size-8 stroke-[2.2]" />
            </div>
            <h3 className="mt-4 font-display text-metric font-bold text-ink">
              Você ainda não possui contatos cadastrados
            </h3>
            <p className="mt-1.5 max-w-sm text-body text-muted leading-relaxed">
              Comece cadastrando novos clientes manualmente ou faça uma importação rápida de planilha CSV.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Button
                variant="primary"
                size="md"
                icon={<Plus className="size-4" />}
                onClick={() => setIsNewContactOpen(true)}
              >
                Adicionar novo contato
              </Button>
              <Button
                variant="secondary"
                size="md"
                icon={<Upload className="size-4" />}
                onClick={() => setIsImportOpen(true)}
              >
                Importar contatos
              </Button>
            </div>
          </div>
        ) : sortedContacts.length === 0 ? (
          /* Estado Vazio da Busca / Filtro */
          <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-surface p-10 text-center shadow-xs">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 border border-line-soft text-dim">
              {tab === 'grupos' ? <Users className="size-6" /> : <Search className="size-6" />}
            </div>
            <h3 className="mt-3.5 font-display text-title font-bold text-ink">
              {tab === 'grupos' ? 'Nenhum grupo do WhatsApp encontrado' : 'Nenhum contato encontrado'}
            </h3>
            <p className="mt-1 max-w-md text-body text-muted leading-relaxed">
              {tab === 'grupos'
                ? 'Clique em "Buscar grupos do WhatsApp" acima para carregar todos os grupos em que seu número conectado participa.'
                : 'Tente buscar por outro nome, telefone, e-mail ou empresa para localizar o cliente desejado.'}
            </p>
            {tab === 'grupos' ? (
              <Button
                variant="primary"
                size="sm"
                className="mt-4"
                onClick={handleSyncGroups}
                disabled={isSyncingGroups}
              >
                {isSyncingGroups ? 'Buscando grupos...' : 'Buscar grupos do WhatsApp'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={() => setSearch('')}
              >
                Limpar busca
              </Button>
            )}
          </div>
        ) : (
          /* Tabela com Contatos */
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-body border-collapse">
                <caption className="sr-only">Base de contatos da conta</caption>

                {/* Cabeçalho da Tabela com Ordenação */}
                <thead className="border-b border-line bg-surface-2/70 text-meta text-dim uppercase tracking-wider select-none font-semibold">
                  <tr>
                    <th scope="col" className="w-12 px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        aria-label="Selecionar todos os contatos visíveis"
                        className="size-4 rounded border-line text-brand focus:ring-brand/30 cursor-pointer"
                      />
                    </th>

                    <th
                      scope="col"
                      onClick={() => handleSort('name')}
                      className="px-4 py-3 cursor-pointer hover:text-ink transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Nome / Identificação</span>
                        {sortField === 'name' ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="size-3.5 text-brand" />
                          ) : (
                            <ArrowDown className="size-3.5 text-brand" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 text-dim/60" />
                        )}
                      </div>
                    </th>

                    <th
                      scope="col"
                      onClick={() => handleSort('phone')}
                      className="px-4 py-3 cursor-pointer hover:text-ink transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{tab === 'grupos' ? 'Membros' : 'Telefone'}</span>
                        {sortField === 'phone' ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="size-3.5 text-brand" />
                          ) : (
                            <ArrowDown className="size-3.5 text-brand" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 text-dim/60" />
                        )}
                      </div>
                    </th>

                    <th
                      scope="col"
                      onClick={() => handleSort('company')}
                      className="px-4 py-3 cursor-pointer hover:text-ink transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{tab === 'grupos' ? 'Atendimento no Chat' : 'Empresa / Status'}</span>
                        {sortField === 'company' ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="size-3.5 text-brand" />
                          ) : (
                            <ArrowDown className="size-3.5 text-brand" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 text-dim/60" />
                        )}
                      </div>
                    </th>

                    <th scope="col" className="px-4 py-3">
                      Etiquetas
                    </th>

                    <th
                      scope="col"
                      onClick={() => handleSort('lastContactAt')}
                      className="px-4 py-3 cursor-pointer hover:text-ink transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Última Atividade</span>
                        {sortField === 'lastContactAt' ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="size-3.5 text-brand" />
                          ) : (
                            <ArrowDown className="size-3.5 text-brand" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 text-dim/60" />
                        )}
                      </div>
                    </th>

                    <th
                      scope="col"
                      onClick={() => handleSort('ownerName')}
                      className="px-4 py-3 cursor-pointer hover:text-ink transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Responsável</span>
                        {sortField === 'ownerName' ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="size-3.5 text-brand" />
                          ) : (
                            <ArrowDown className="size-3.5 text-brand" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 text-dim/60" />
                        )}
                      </div>
                    </th>

                    <th scope="col" className="w-12 px-4 py-3 text-right">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>

                {/* Linhas da Tabela */}
                <tbody className="divide-y divide-line-soft">
                  {pagedContacts.map((contact) => {
                    const isChecked = selected.includes(contact.id);
                    const isMenuOpen = activeMenuId === contact.id;
                    const isGroup = contact.kind === 'grupo';
                    const isAllowed = isGroupAllowedInChat(contact);
                    const formattedPhone = PhoneNumber.format(contact.phone);
                    const nameIsPhone =
                      !isGroup &&
                      PhoneNumber.normalize(contact.name) === PhoneNumber.normalize(contact.phone);

                    return (
                      <tr
                        key={contact.id}
                        className={cn(
                          'group transition-colors',
                          isChecked
                            ? 'bg-brand/5 dark:bg-brand/10'
                            : 'hover:bg-surface-2/60',
                        )}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectOne(contact.id)}
                            aria-label={`Selecionar ${contact.name}`}
                            className="size-4 rounded border-line text-brand focus:ring-brand/30 cursor-pointer"
                          />
                        </td>

                        {/* Nome do Contato + Avatar */}
                        <th scope="row" className="px-4 py-3 font-normal">
                          <button
                            type="button"
                            onClick={() => setSelectedDrawerContact(contact)}
                            className="flex items-center gap-3 text-left group-hover:text-brand transition-colors"
                          >
                            <Avatar
                              name={contact.name}
                              tone={contact.avatarTone}
                              size="sm"
                              className="shrink-0 shadow-2xs"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="block font-semibold text-ink leading-tight line-clamp-1">
                                  {nameIsPhone ? 'Contato do WhatsApp' : contact.name}
                                </span>
                                {isGroup && (
                                  <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold px-1.5 py-0.5 border border-indigo-500/20">
                                    Grupo
                                  </span>
                                )}
                              </div>
                              {contact.email ? (
                                <span className="block text-meta text-muted line-clamp-1 mt-0.5">
                                  {contact.email}
                                </span>
                              ) : isGroup ? (
                                <span className="block text-[11px] text-muted line-clamp-1 mt-0.5">
                                  WhatsApp Grupo · {contact.participantCount ?? 0} participantes
                                </span>
                              ) : null}
                            </div>
                          </button>
                        </th>

                        {/* Telefone Formatado / Membros do Grupo */}
                        <td className="px-4 py-3 font-mono tabular-nums text-ink text-meta font-medium">
                          {isGroup ? (
                            <span className="text-muted inline-flex items-center gap-1.5 font-sans">
                              <Users className="size-3.5 text-dim" />
                              <span>{contact.participantCount ?? 0} membros</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              {formattedPhone}
                              {/* Sem isto, o segundo número de uma pessoa só
                                  aparecia abrindo o cadastro — e ninguém abre
                                  um cadastro para descobrir que existe algo
                                  que não sabia estar lá. */}
                              {contact.extraPhones && contact.extraPhones.length > 0 ? (
                                <span
                                  title={contact.extraPhones
                                    .map((n) => PhoneNumber.format(n))
                                    .join(' · ')}
                                  className="rounded-md bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] font-bold text-muted border border-line-soft"
                                >
                                  +{contact.extraPhones.length}
                                </span>
                              ) : null}
                            </span>
                          )}
                        </td>

                        {/* Empresa ou Switch de Atendimento no Chat */}
                        <td className="px-4 py-3 text-muted">
                          {isGroup ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isAllowed}
                                disabled={togglingGroupId === contact.id}
                                onClick={() => handleToggleGroup(contact, isAllowed)}
                                title={isAllowed ? 'Desativar grupo do chat' : 'Autorizar grupo no chat'}
                                className={cn(
                                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2',
                                  isAllowed ? 'bg-emerald-600' : 'bg-line-strong dark:bg-surface-2',
                                  togglingGroupId === contact.id && 'opacity-50 cursor-wait',
                                )}
                              >
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    'pointer-events-none inline-block size-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                                    isAllowed ? 'translate-x-4' : 'translate-x-0',
                                  )}
                                />
                              </button>
                              <span
                                className={cn(
                                  'text-[11px] font-semibold px-2 py-0.5 rounded-md border',
                                  isAllowed
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                                )}
                              >
                                {isAllowed ? 'Permitido no Chat' : 'Pendente'}
                              </span>
                            </div>
                          ) : contact.company ? (
                            <span className="text-ink font-medium">{contact.company}</span>
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>

                        {/* Etiquetas */}
                        <td className="px-4 py-3">
                          {contact.labels.length > 0 ? (
                            <LabelChips labels={contact.labels} />
                          ) : (
                            <span className="text-dim text-meta">—</span>
                          )}
                        </td>

                        {/* Último Contato */}
                        <td className="px-4 py-3 text-meta text-muted">
                          {contact.lastContactLabel ? (
                            <span className="inline-flex items-center gap-1.5 text-ink">
                              <span className="size-1.5 rounded-full bg-emerald-500" />
                              <span>{contact.lastContactLabel}</span>
                            </span>
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>

                        {/* Responsável */}
                        <td className="px-4 py-3 text-meta">
                          {contact.ownerName ? (
                            <div className="flex items-center gap-1.5 text-ink">
                              <Avatar name={contact.ownerName} size="xs" />
                              <span className="font-medium">{contact.ownerName}</span>
                            </div>
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>

                        {/* Menu de Ações por Linha */}
                        <td className="px-4 py-3 text-right relative">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setSelectedDrawerContact(contact)}
                              title="Ver detalhes"
                              className="rounded-control p-1 text-dim hover:text-brand hover:bg-surface-2 transition-colors"
                            >
                              <ExternalLink className="size-4" />
                            </button>

                            <div className="relative">
                              <button
                                type="button"
                                aria-label={`Ações para ${contact.name}`}
                                aria-haspopup="menu"
                                aria-expanded={isMenuOpen}
                                onClick={(evento) => {
                                  if (isMenuOpen) {
                                    setActiveMenuId(null);
                                    return;
                                  }
                                  // O retângulo é lido no clique porque é aqui
                                  // que o botão certamente existe e está na
                                  // posição final — depois disso o menu vive
                                  // fora desta árvore.
                                  setMenuAnchor(evento.currentTarget.getBoundingClientRect());
                                  setActiveMenuId(contact.id);
                                }}
                                className="rounded-control p-1 text-dim hover:text-ink hover:bg-surface-2 transition-colors"
                              >
                                <MoreHorizontal className="size-4" />
                              </button>

                              {/* Dropdown Menu */}
                              {isMenuOpen && menuAnchor && (
                                <FloatingDropdown
                                  anchor={menuAnchor}
                                  onClose={() => setActiveMenuId(null)}
                                >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        setSelectedDrawerContact(contact);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-meta text-ink hover:bg-surface-2 transition-colors"
                                    >
                                      <User className="size-3.5 text-muted" />
                                      <span>Ver detalhes</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        setEditingContact(contact);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-meta text-ink hover:bg-surface-2 transition-colors"
                                    >
                                      <Pencil className="size-3.5 text-muted" />
                                      <span>Editar contato</span>
                                    </button>

                                    <StartConversationButton
                                      contact={contact}
                                      onNavigate={() => setActiveMenuId(null)}
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-meta text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                    >
                                      <span>Iniciar conversa</span>
                                    </StartConversationButton>

                                    <Link
                                      href="/kanban"
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-meta text-ink hover:bg-surface-2 transition-colors"
                                    >
                                      <Kanban className="size-3.5 text-brand" />
                                      <span>Ver no funil</span>
                                    </Link>

                                    <div className="my-1 border-t border-line-soft" />

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        setContactToDelete(contact);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-meta text-red-600 hover:bg-red-soft transition-colors"
                                    >
                                      <Trash2 className="size-3.5" />
                                      <span>Excluir contato</span>
                                    </button>
                                </FloatingDropdown>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Rodapé da Tabela: contagem e navegação entre páginas */}
            <div className="flex flex-col gap-3 border-t border-line px-5 py-3 text-meta text-muted bg-surface-2/30 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Mostrando{' '}
                <strong className="text-ink font-semibold">
                  {pagedContacts.length === 0 ? 0 : pageStart + 1}–{pageStart + pagedContacts.length}
                </strong>{' '}
                de <strong className="text-ink font-semibold">{sortedContacts.length}</strong>
                {sortedContacts.length !== contacts.length ? (
                  <> filtrados ({contacts.length} na base)</>
                ) : (
                  <> contatos na base</>
                )}
                {search ? <span className="text-dim"> · &ldquo;{search}&rdquo;</span> : null}
              </span>

              {/* Some quando há uma página só — um controle que não leva a
                  lugar nenhum é ruído. */}
              {totalPages > 1 ? (
                <nav className="flex items-center gap-1.5" aria-label="Paginação de contatos">
                  <button
                    type="button"
                    onClick={() => setPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-2.5 py-1 font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="size-3.5" />
                    Anterior
                  </button>

                  <span className="px-2 tabular-nums">
                    Página <strong className="text-ink font-semibold">{currentPage}</strong> de{' '}
                    <strong className="text-ink font-semibold">{totalPages}</strong>
                  </span>

                  <button
                    type="button"
                    onClick={() => setPage(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-2.5 py-1 font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Próxima
                    <ChevronRight className="size-3.5" />
                  </button>
                </nav>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* DRAWER LATERAL & MODAIS                                      */}
      {/* ============================================================ */}
      <ContactDrawer
        contact={selectedDrawerContact}
        open={Boolean(selectedDrawerContact)}
        onClose={() => setSelectedDrawerContact(null)}
        onEdit={(contact) => setEditingContact(contact)}
        onDelete={(id) => {
          setSelected((prev) => prev.filter((item) => item !== id));
        }}
      />

      <NewContactModal
        open={isNewContactOpen}
        onClose={() => setIsNewContactOpen(false)}
      />

      <EditContactModal
        contact={editingContact}
        open={Boolean(editingContact)}
        onClose={() => setEditingContact(null)}
        onUpdated={(updated) => {
          if (selectedDrawerContact?.id === updated.id) {
            setSelectedDrawerContact(updated);
          }
        }}
      />

      <SaveSegmentModal
        open={isSegmentOpen}
        onClose={() => setIsSegmentOpen(false)}
        currentSearch={search}
        matchingCount={sortedContacts.length}
      />

      <ImportCsvModal
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />

      {/* Confirmação de Exclusão Individual */}
      <ConfirmModal
        open={Boolean(contactToDelete)}
        title="Excluir contato"
        description={
          <span>
            Tem certeza que deseja excluir o contato{' '}
            <strong className="text-ink">&ldquo;{contactToDelete?.name}&rdquo;</strong>? O histórico de atendimentos, conversas e oportunidades comerciais vinculadas serão removidos permanentemente.
          </span>
        }
        confirmLabel="Excluir contato"
        variant="danger"
        isLoading={isPending}
        onClose={() => setContactToDelete(null)}
        onConfirm={handleConfirmDeleteSingle}
      />

      {/* Confirmação de Exclusão em Massa */}
      <ConfirmModal
        open={isBulkDeleteOpen}
        title="Excluir contatos selecionados"
        description={
          <span>
            Tem certeza que deseja excluir permanentemente os{' '}
            <strong className="text-ink">{selected.length} contatos selecionados</strong>? Esta ação é irreversível e removerá todas as informações comerciais associadas.
          </span>
        }
        confirmLabel={`Excluir ${selected.length} contatos`}
        variant="danger"
        isLoading={isPending}
        onClose={() => setIsBulkDeleteOpen(false)}
        onConfirm={handleConfirmBulkDelete}
      />
    </>
  );
}
