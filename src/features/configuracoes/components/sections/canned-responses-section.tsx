'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { CannedResponse } from '@/core/domain/settings';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import {
  createCannedResponseAction,
  deleteCannedResponseAction,
} from '@/app/(workspace)/configuracoes/actions';

interface CannedResponsesSectionProps {
  readonly cannedResponses: readonly CannedResponse[];
}

export function CannedResponsesSection({ cannedResponses }: CannedResponsesSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deletingResponse, setDeletingResponse] = useState<CannedResponse | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createCannedResponseAction({ shortcut, content });
      if (res.ok) {
        setIsModalOpen(false);
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
    setShortcut('/');
    setContent('');
    setError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: CannedResponse) => {
    setShortcut(item.shortcut);
    setContent(item.content);
    setError(null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Configurar resposta rápida"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-md bg-danger/10 p-3 text-body text-danger">
              {error}
            </div>
          )}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">
              Atalho (inicie com /)
            </label>
            <input
              type="text"
              required
              placeholder="/ola"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">
              Texto da mensagem
            </label>
            <textarea
              required
              rows={4}
              placeholder="Digite o texto que será enviado ao usar o atalho..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !shortcut.trim() || !content.trim()}>
              {isPending ? 'Salvando...' : 'Salvar resposta'}
            </Button>
          </div>
        </form>
      </Modal>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-title font-bold text-ink tracking-tight">
            Respostas rápidas
          </h3>
          <p className="text-body text-muted">
            Atalhos iniciados por <code className="font-mono text-brand font-semibold">/</code> no chat para
            agilizar respostas frequentes.
          </p>
        </div>
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={handleOpenNew}>
          Nova resposta rápida
        </Button>
      </div>

      <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
        <div className="divide-y divide-line-soft">
          {cannedResponses.length === 0 ? (
            <div className="p-4 text-center text-body text-muted">Nenhuma resposta rápida cadastrada.</div>
          ) : (
            cannedResponses.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 p-4 transition-colors hover:bg-surface-2/60"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-control bg-accent-soft border border-accent-line/40 px-2.5 py-0.5 font-mono text-meta font-bold text-accent-soft-text">
                    {item.shortcut}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(item)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Excluir resposta rápida ${item.shortcut}`}
                      onClick={() => setDeletingResponse(item)}
                      icon={<Trash2 className="size-3.5 text-danger" />}
                    />
                  </div>
                </div>
                <p className="text-ui text-ink leading-relaxed font-normal">{item.content}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmModal
        open={deletingResponse !== null}
        title="Excluir resposta rápida"
        description={
          <span>
            Tem certeza que deseja excluir o atalho{' '}
            <strong className="font-mono text-ink">{deletingResponse?.shortcut}</strong>? Ele não estará mais disponível para autocompletar no chat.
          </span>
        }
        confirmLabel="Excluir resposta rápida"
        variant="danger"
        isLoading={isPending}
        onClose={() => setDeletingResponse(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>

  );
}
