'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { MESSAGE_VARIABLES } from '@/core/domain/message-variables';
import type { CannedResponse } from '@/core/domain/settings';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import {
  createCannedResponseAction,
  deleteCannedResponseAction,
  updateCannedResponseAction,
} from '@/app/(workspace)/configuracoes/actions';

interface CannedResponsesSectionProps {
  readonly cannedResponses: readonly CannedResponse[];
}

export function CannedResponsesSection({ cannedResponses }: CannedResponsesSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deletingResponse, setDeletingResponse] = useState<CannedResponse | null>(null);
  /** Resposta em edição, ou `null` para criação — é o que decide qual action chamar. */
  const [editingResponse, setEditingResponse] = useState<CannedResponse | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cannedResponses;
    return cannedResponses.filter(
      (item) =>
        item.shortcut.toLowerCase().includes(term) ||
        item.content.toLowerCase().includes(term),
    );
  }, [cannedResponses, search]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = editingResponse
        ? await updateCannedResponseAction({
            responseId: editingResponse.id,
            shortcut,
            content,
          })
        : await createCannedResponseAction({ shortcut, content });

      if (res.ok) {
        setIsModalOpen(false);
        setEditingResponse(null);
        setShortcut('');
        setContent('');
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao salvar resposta rápida.');
      }
    });
  };

  const handleConfirmDelete = async () => {
    if (!deletingResponse) return;
    startTransition(async () => {
      await deleteCannedResponseAction({ responseId: deletingResponse.id });
      setDeletingResponse(null);
      router.refresh();
    });
  };

  const handleOpenNew = () => {
    setEditingResponse(null);
    setShortcut('/');
    setContent('');
    setError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: CannedResponse) => {
    setEditingResponse(item);
    setShortcut(item.shortcut);
    setContent(item.content);
    setError(null);
    setIsModalOpen(true);
  };

  const insertVariable = (variableTag: string) => {
    setContent((prev) => `${prev} ${variableTag} `);
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-200">
      {/* ============================================================ */}
      {/* CABEÇALHO                                                    */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">
              Respostas rápidas
            </h2>
            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              {cannedResponses.length} cadastradas
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Agilize o atendimento com mensagens prontas iniciadas por <code className="font-mono text-blue-600 dark:text-blue-400 font-bold">/</code> no chat.
          </p>
        </div>

        <Button
          size="md"
          icon={<Plus className="size-4" />}
          onClick={handleOpenNew}
        >
          Nova resposta
        </Button>
      </div>

      {/* ============================================================ */}
      {/* CAMPO DE BUSCA                                               */}
      {/* ============================================================ */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-dim" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar respostas rápidas por atalho ou conteúdo..."
          className="h-10 w-full rounded-xl border border-line bg-surface pr-9 pl-10 text-xs text-ink placeholder:text-dim outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-dim hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/* ============================================================ */}
      {/* LISTA DE RESPOSTAS RÁPIDAS                                    */}
      {/* ============================================================ */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2/40 p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-dim mb-3">
            <MessageSquare className="size-6" />
          </div>
          <h4 className="font-display text-base font-bold text-ink">
            {search ? 'Nenhuma resposta encontrada' : 'Nenhuma resposta rápida cadastrada'}
          </h4>
          <p className="mt-1 max-w-md text-xs text-muted">
            {search
              ? 'Tente pesquisar por outros termos.'
              : 'Cadastre respostas padronizadas para saudações, cobrança, envio de dados bancários ou dúvidas frequentes.'}
          </p>
          <Button size="md" className="mt-5" icon={<Plus className="size-4" />} onClick={handleOpenNew}>
            Cadastrar primeira resposta
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="group flex flex-col justify-between rounded-2xl border border-line bg-surface p-4.5 shadow-2xs transition-all hover:border-brand/40 hover:shadow-xs"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 font-mono text-xs font-bold text-blue-600 dark:text-blue-400 shadow-2xs">
                    {item.shortcut}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(item)}
                      icon={<Pencil className="size-3.5" />}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Excluir resposta ${item.shortcut}`}
                      onClick={() => setDeletingResponse(item)}
                      icon={<Trash2 className="size-3.5 text-red-500" />}
                    />
                  </div>
                </div>

                <p className="mt-3 text-xs text-ink leading-relaxed font-normal">
                  {item.content}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-line-soft pt-3 text-[11px] text-dim">
                <span className="flex items-center gap-1 font-medium">
                  <Sparkles className="size-3 text-amber-500" />
                  Pronta para autocompletar
                </span>
                <span className="font-mono text-[10px]">
                  {item.content.length} caracteres
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Criar/Editar */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingResponse ? `Editar ${editingResponse.shortcut}` : 'Nova resposta rápida'}
        description="Digite o atalho iniciado com barra e a mensagem correspondente."
        className="max-w-md"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4 pt-1">
          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <div>
            <label htmlFor="shortcut-input" className="mb-1 block text-xs font-semibold text-ink">
              Atalho de ativação (inicie com /)
            </label>
            <input
              id="shortcut-input"
              type="text"
              required
              placeholder="/ola, /pix, /horario"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="content-input" className="text-xs font-semibold text-ink">
                Texto da mensagem
              </label>
              <span className="text-[11px] text-dim">Variáveis dinâmicas:</span>
            </div>

            {/* Inserção de variáveis dinâmicas.

                A lista vem do domínio, e não de uma cópia local: era uma cópia,
                e a cópia era a única coisa que existia — não havia
                interpolador em lugar nenhum, e o cliente recebia
                `Olá {{cliente.nome}}` escrito assim mesmo. */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {MESSAGE_VARIABLES.map((v) => (
                <button
                  type="button"
                  key={v.tag}
                  onClick={() => insertVariable(v.tag)}
                  title={`${v.label}: ${v.hint}`}
                  className="rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-mono text-muted hover:border-brand hover:text-brand transition-colors"
                >
                  {v.tag}
                </button>
              ))}
            </div>

            <p className="mb-2 text-[11px] leading-relaxed text-dim">
              Ao usar a resposta na conversa, cada variável é trocada pelo valor daquele
              atendimento. Variável sem valor some do texto: o cliente nunca vê a chave.
            </p>

            <textarea
              id="content-input"
              required
              rows={4}
              placeholder="Digite o texto que será enviado automaticamente quando o operador digitar o atalho..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface p-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !shortcut.trim() || !content.trim()}>
              {isPending ? 'Salvando…' : 'Salvar resposta'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmação de Exclusão */}
      <ConfirmModal
        open={deletingResponse !== null}
        title="Excluir resposta rápida"
        description={
          <span>
            Tem certeza que deseja excluir o atalho{' '}
            <strong className="font-mono text-ink">{deletingResponse?.shortcut}</strong>? Ele não estará mais disponível para autocompletar no chat.
          </span>
        }
        confirmLabel="Excluir resposta"
        variant="danger"
        isLoading={isPending}
        onClose={() => setDeletingResponse(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
