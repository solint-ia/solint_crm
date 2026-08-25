'use client';

import { useState, useTransition } from 'react';
import { Bookmark, Filter } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { saveSegmentAction } from '@/app/(workspace)/contatos/actions';

interface SaveSegmentModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly currentSearch: string;
  readonly matchingCount: number;
}

export function SaveSegmentModal({
  open,
  onClose,
  currentSearch,
  matchingCount,
}: SaveSegmentModalProps) {
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setDescription('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await saveSegmentAction({
        name: name.trim(),
        description: description.trim() ? description.trim() : undefined,
        filters: currentSearch.trim()
          ? [{ field: 'search', operator: 'contains', value: currentSearch.trim() }]
          : [],
        contactCount: matchingCount,
      });

      if (res.ok) {
        show({
          tone: 'sucesso',
          title: 'Segmento salvo com sucesso!',
          description: `O segmento "${name}" agrupa ${matchingCount} contatos.`,
        });
        handleClose();
      } else {
        setError(res.error ?? 'Erro ao salvar segmento.');
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Salvar Segmento Inteligente"
      description="Crie um filtro salvo para acessar rapidamente esta lista de contatos."
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-1">
        {error && (
          <div className="rounded-lg bg-red-soft p-3 text-meta text-red-text border border-red-line/40">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-line-soft bg-surface-2/50 p-3 text-body flex items-start gap-2.5">
          <Filter className="size-4 text-brand shrink-0 mt-0.5" />
          <div className="text-meta leading-relaxed">
            Este segmento incluirá dinamicamente todos os contatos que atendem aos filtros atuais (
            <strong className="text-ink font-semibold">{matchingCount} contatos encontrados</strong>).
            {currentSearch.trim() && (
              <span className="block mt-1 text-dim">
                Filtro ativo: &ldquo;{currentSearch}&rdquo;
              </span>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-ink">
            <Bookmark className="size-3.5 text-muted" />
            <span>Nome do segmento <span className="text-red-500">*</span></span>
          </label>
          <input
            type="text"
            required
            placeholder="Ex: Clientes VIP São Paulo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors focus:border-brand"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-meta font-medium text-ink">
            Descrição (opcional)
          </label>
          <input
            type="text"
            placeholder="Finalidade ou estratégia deste grupo..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors focus:border-brand"
          />
        </div>

        <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-line-soft pt-4">
          <Button variant="secondary" size="sm" type="button" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={isPending || !name.trim()}
          >
            {isPending ? 'Salvando...' : 'Salvar segmento'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
