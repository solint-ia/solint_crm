'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { Label } from '@/core/domain/label';
import { LabelChip } from '@/components/domain/label-chip';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ColorPicker, normalizeToHex, POPULAR_COLORS } from '@/components/ui/color-picker';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  createLabelAction,
  deleteLabelAction,
  updateLabelAction,
} from '@/app/(workspace)/configuracoes/actions';

interface LabelsSectionProps {
  readonly labels: readonly Label[];
}

export function LabelsSection({ labels: initialLabels }: LabelsSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [labels, setLabels] = useState<readonly Label[]>(initialLabels);

  // A lista é do servidor, não deste componente: depois de gravar, o
  // `router.refresh()` traz a versão nova e ela precisa substituir a antiga.
  useEffect(() => {
    setLabels(initialLabels);
  }, [initialLabels]);

  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [selectedTone, setSelectedTone] = useState<string>('todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<Label | null>(null);

  const [labelName, setLabelName] = useState('');
  const [labelTone, setLabelTone] = useState<string>('#3B82F6');
  const [labelDescription, setLabelDescription] = useState('');

  const { show } = useToast();

  const filteredLabels = useMemo(() => {
    return labels.filter((lbl) => {
      const matchesSearch =
        lbl.name.toLowerCase().includes(search.toLowerCase()) ||
        (lbl.description?.toLowerCase().includes(search.toLowerCase()) ?? false);
      const matchesTone =
        selectedTone === 'todos' ||
        lbl.tone === selectedTone ||
        normalizeToHex(lbl.tone).toUpperCase() === normalizeToHex(selectedTone).toUpperCase();
      return matchesSearch && matchesTone;
    });
  }, [labels, search, selectedTone]);

  const handleOpenNew = () => {
    setEditingLabel(null);
    setLabelName('');
    setLabelTone('#3B82F6');
    setLabelDescription('');
    setError(undefined);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (lbl: Label) => {
    setError(undefined);
    setEditingLabel(lbl);
    setLabelName(lbl.name);
    setLabelTone(normalizeToHex(lbl.tone));
    setLabelDescription(lbl.description ?? '');
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const name = labelName.trim();
    if (!name) return;

    // A conferência que vale é a do servidor — esta só evita a ida ao banco e
    // responde na hora. Mesma régua dos dois lados: caixa e espaços das pontas
    // não distinguem uma etiqueta de outra.
    const duplicada = labels.some(
      (lbl) =>
        lbl.id !== editingLabel?.id && lbl.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicada) {
      setError(`Já existe uma etiqueta chamada "${name}".`);
      return;
    }

    setError(undefined);
    const draft = {
      name,
      tone: labelTone,
      ...(labelDescription.trim() ? { description: labelDescription.trim() } : {}),
    };

    startTransition(async () => {
      const result = editingLabel
        ? await updateLabelAction({ labelId: editingLabel.id, ...draft })
        : await createLabelAction(draft);

      if (!result.ok) {
        setError(result.error ?? 'Erro ao salvar etiqueta.');
        return;
      }

      show({
        tone: 'sucesso',
        title: editingLabel ? 'Etiqueta atualizada' : 'Etiqueta criada',
        description: `Etiqueta "${name}" foi salva com sucesso.`,
      });
      setIsModalOpen(false);
      router.refresh();
    });
  };

  const handleConfirmDelete = () => {
    if (!deletingLabel) return;
    const alvo = deletingLabel;

    startTransition(async () => {
      const result = await deleteLabelAction({ labelId: alvo.id });
      setDeletingLabel(null);

      if (!result.ok) {
        show({
          tone: 'erro',
          title: 'Falha ao excluir',
          description: result.error ?? 'Não foi possível excluir a etiqueta.',
        });
        return;
      }

      show({
        tone: 'sucesso',
        title: 'Etiqueta removida',
        description: `Etiqueta "${alvo.name}" foi excluída.`,
      });
      router.refresh();
    });
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
              Etiquetas
            </h2>
            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              {labels.length} {labels.length === 1 ? 'etiqueta' : 'etiquetas'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Organize conversas e contatos com marcadores visuais e filtros rápidos.
          </p>
        </div>

        <Button
          size="md"
          icon={<Plus className="size-4" />}
          onClick={handleOpenNew}
        >
          Nova etiqueta
        </Button>
      </div>

      {/* ============================================================ */}
      {/* BARRA DE FERRAMENTAS: BUSCA E FILTRO DE CORES                */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-dim" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou descrição da etiqueta..."
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

        {/* Filtro por tom */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setSelectedTone('todos')}
            className={cn(
              'rounded-xl px-3 py-1.5 text-xs font-semibold transition-all',
              selectedTone === 'todos'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-bold'
                : 'border border-line bg-surface text-muted hover:bg-surface-2',
            )}
          >
            Todas
          </button>
          {POPULAR_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => setSelectedTone(c.hex)}
              className={cn(
                'flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-all',
                selectedTone.toUpperCase() === c.hex.toUpperCase()
                  ? 'bg-surface text-ink border border-brand shadow-2xs font-bold'
                  : 'border border-line bg-surface text-muted hover:bg-surface-2',
              )}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: c.hex }} />
              <span className="hidden sm:inline">{c.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ============================================================ */}
      {/* LISTA DE ETIQUETAS                                           */}
      {/* ============================================================ */}
      {filteredLabels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2/40 p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-dim mb-3">
            <Tag className="size-6" />
          </div>
          <h4 className="font-display text-base font-bold text-ink">
            Nenhuma etiqueta encontrada
          </h4>
          <p className="mt-1 max-w-sm text-xs text-muted">
            {search || selectedTone !== 'todos'
              ? 'Tente ajustar os termos de busca ou o filtro de cores selecionado.'
              : 'Cadastre sua primeira etiqueta para categorizar conversas por prioridade, canal ou assunto.'}
          </p>
          <Button size="md" className="mt-5" icon={<Plus className="size-4" />} onClick={handleOpenNew}>
            Nova etiqueta
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-2xs">
          <div className="divide-y divide-line-soft">
            {filteredLabels.map((label) => (
              <div
                key={label.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-surface-2/50"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <LabelChip label={label} />
                  {label.description ? (
                    <span className="text-xs text-muted truncate">
                      {label.description}
                    </span>
                  ) : (
                    <span className="text-xs text-dim italic">Sem descrição</span>
                  )}
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex items-center gap-3 text-xs text-dim">
                    <span className="tabular-nums">Conversas e contatos ativos</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(label)}
                      icon={<Pencil className="size-3.5" />}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Excluir etiqueta ${label.name}`}
                      onClick={() => setDeletingLabel(label)}
                      icon={<Trash2 className="size-3.5 text-red-500" />}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal Criar/Editar Etiqueta */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingLabel ? 'Editar etiqueta' : 'Nova etiqueta'}
        description="Defina um nome de identificação e selecione a cor livre ou código hexadecimal."
        className="max-w-md"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4 pt-1">
          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-meta text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <div>
            <label htmlFor="label-name" className="mb-1 block text-xs font-semibold text-ink">
              Nome da etiqueta
            </label>
            <input
              id="label-name"
              type="text"
              required
              placeholder="Ex: VIP, Orçamento pendente, Suporte N2"
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <ColorPicker
            label="Cor da etiqueta (livre ou código hexadecimal)"
            value={labelTone}
            onChange={setLabelTone}
          />

          <div>
            <label htmlFor="label-desc" className="mb-1 block text-xs font-semibold text-ink">
              Descrição ou regra de aplicação (opcional)
            </label>
            <textarea
              id="label-desc"
              rows={3}
              placeholder="Descreva quando esta etiqueta deve ser aplicada aos contatos..."
              value={labelDescription}
              onChange={(e) => setLabelDescription(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface p-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !labelName.trim()}>
              {isPending
                ? 'Salvando…'
                : editingLabel
                  ? 'Salvar alterações'
                  : 'Criar etiqueta'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmação de Exclusão */}
      <ConfirmModal
        open={deletingLabel !== null}
        title="Excluir etiqueta"
        description={
          <span>
            Tem certeza que deseja excluir a etiqueta{' '}
            <strong className="text-ink">{deletingLabel?.name}</strong>? Ela será removida das conversas e contatos existentes.
          </span>
        }
        confirmLabel="Excluir etiqueta"
        variant="danger"
        onClose={() => setDeletingLabel(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
