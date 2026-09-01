'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { PipelineStage } from '@/core/domain/pipeline';
import type { Label } from '@/core/domain/label';
import { STAGE_COLOR_PRESETS } from '@/core/domain/pipeline';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';


interface StagesModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly stages: readonly PipelineStage[];
  /** Etiquetas da conta, para vincular uma a cada etapa. */
  readonly labels: readonly Label[];
  readonly onSaveStages: (
    updatedStages: readonly {
      id?: string;
      name: string;
      order: number;
      color: string;
      isWon: boolean;
      isLost: boolean;
      labelId?: string | null;
    }[],
  ) => Promise<void>;
}

export function StagesModal({
  open,
  onClose,
  stages: initialStages,
  labels,
  onSaveStages,
}: StagesModalProps) {
  const [stages, setStages] = useState<
    {
      id: string;
      name: string;
      order: number;
      color: string;
      isWon: boolean;
      isLost: boolean;
      /** String vazia = etapa sem etiqueta. Vira `null` ao salvar. */
      labelId: string;
    }[]
  >(
    initialStages.map((s, idx) => ({
      id: s.id,
      name: s.name,
      order: s.order ?? idx + 1,
      color: s.color,
      isWon: s.isWon ?? false,
      isLost: s.isLost ?? false,
      labelId: s.labelId ?? '',
    })),
  );

  /**
   * Uma etiqueta não pode representar duas etapas.
   *
   * Se representasse, um contato com ela estaria em duas colunas ao mesmo
   * tempo e não haveria como decidir qual vale. O `<select>` esconde as já
   * usadas em vez de deixar escolher e recusar depois.
   */
  const usadas = new Set(stages.map((stage) => stage.labelId).filter(Boolean));

  const updateLabel = (index: number, labelId: string) => {
    setStages((prev) => prev.map((st, i) => (i === index ? { ...st, labelId } : st)));
  };

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mover etapa para cima
  const moveUp = (index: number) => {
    if (index === 0) return;
    setStages((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1]!;
      copy[index - 1] = copy[index]!;
      copy[index] = temp;
      return copy.map((st, i) => ({ ...st, order: i + 1 }));
    });
  };

  // Mover etapa para baixo
  const moveDown = (index: number) => {
    if (index === stages.length - 1) return;
    setStages((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1]!;
      copy[index + 1] = copy[index]!;
      copy[index] = temp;
      return copy.map((st, i) => ({ ...st, order: i + 1 }));
    });
  };

  // Alterar cor da etapa
  const updateColor = (index: number, color: string) => {
    setStages((prev) =>
      prev.map((st, i) => (i === index ? { ...st, color } : st)),
    );
  };

  // Alterar nome
  const updateName = (index: number, name: string) => {
    setStages((prev) =>
      prev.map((st, i) => (i === index ? { ...st, name } : st)),
    );
  };

  // Alternar Ganho / Perda
  const toggleWon = (index: number) => {
    setStages((prev) =>
      prev.map((st, i) => {
        if (i !== index) return st;
        const willBeWon = !st.isWon;
        return {
          ...st,
          isWon: willBeWon,
          isLost: willBeWon ? false : st.isLost,
        };
      }),
    );
  };

  const toggleLost = (index: number) => {
    setStages((prev) =>
      prev.map((st, i) => {
        if (i !== index) return st;
        const willBeLost = !st.isLost;
        return {
          ...st,
          isLost: willBeLost,
          isWon: willBeLost ? false : st.isWon,
        };
      }),
    );
  };

  // Excluir etapa
  const removeStage = (index: number) => {
    if (stages.length <= 1) {
      setError('O funil deve conter no mínimo 1 etapa.');
      return;
    }
    setStages((prev) =>
      prev.filter((_, i) => i !== index).map((st, i) => ({ ...st, order: i + 1 })),
    );
  };

  // Adicionar nova etapa
  const addStage = () => {
    const nextOrder = stages.length + 1;
    const defaultColor = STAGE_COLOR_PRESETS[stages.length % STAGE_COLOR_PRESETS.length]?.value ?? '#3B82F6';
    setStages((prev) => [
      ...prev,
      {
        id: `st-new-${Date.now()}`,
        name: `Nova Etapa ${nextOrder}`,
        order: nextOrder,
        color: defaultColor,
        isWon: false,
        isLost: false,
        labelId: '',
      },
    ]);
  };

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);
    try {
      // A string vazia da tela vira `null` no banco: são a mesma ideia
      // ("sem etiqueta") em duas linguagens, e o `<select>` não tem `null`.
      await onSaveStages(
        stages.map((stage) => ({ ...stage, labelId: stage.labelId || null })),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configuração de etapas.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configuração das Etapas do Funil"
      description="Personalize o nome, a cor e a ordem de cada etapa do processo comercial."
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div className="rounded-md bg-red-soft p-3 text-body text-red-text border border-red-line/50">
            {error}
          </div>
        )}

        <ul className="flex flex-col gap-2.5 max-h-[50vh] overflow-y-auto pr-1">
          {stages.map((stage, index) => (
            <li
              key={stage.id}
              className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2/60 p-3 transition-colors hover:border-line"
            >
              <div className="flex items-center gap-2">
                {/* Controles de Ordem */}
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveUp(index)}
                    disabled={index === 0}
                    title="Mover para cima"
                    className="rounded p-0.5 text-dim hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(index)}
                    disabled={index === stages.length - 1}
                    title="Mover para baixo"
                    className="rounded p-0.5 text-dim hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ArrowDown className="size-3" />
                  </button>
                </div>

                {/* Seletor de Cor da Etapa */}
                <div className="relative flex items-center">
                  <input
                    type="color"
                    aria-label={`Cor da etapa ${stage.name}`}
                    value={stage.color.startsWith('#') ? stage.color : '#3B82F6'}
                    onChange={(e) => updateColor(index, e.target.value)}
                    className="size-7 cursor-pointer rounded-full border border-line p-0 bg-transparent"
                  />
                </div>

                {/* Nome da Etapa */}
                <input
                  type="text"
                  value={stage.name}
                  onChange={(e) => updateName(index, e.target.value)}
                  placeholder="Nome da etapa"
                  className="flex-1 min-w-[140px] rounded-control border border-line bg-surface px-2.5 py-1.5 text-body font-semibold text-ink outline-none focus:border-brand"
                />

                {/* Botão Ganho */}
                <button
                  type="button"
                  onClick={() => toggleWon(index)}
                  className={cn(
                    'rounded-control px-2 py-1 text-micro font-semibold transition-colors',
                    stage.isWon
                      ? 'bg-emerald-500 text-white'
                      : 'bg-surface border border-line text-dim hover:text-ink',
                  )}
                >
                  Ganho
                </button>

                {/* Botão Perda */}
                <button
                  type="button"
                  onClick={() => toggleLost(index)}
                  className={cn(
                    'rounded-control px-2 py-1 text-micro font-semibold transition-colors',
                    stage.isLost
                      ? 'bg-red-500 text-white'
                      : 'bg-surface border border-line text-dim hover:text-ink',
                  )}
                >
                  Perda
                </button>

                {/* Excluir */}
                <button
                  type="button"
                  onClick={() => removeStage(index)}
                  title="Excluir etapa"
                  className="rounded-control p-1 text-dim transition-colors hover:bg-red-soft hover:text-red-text"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {/* Etiqueta que representa a etapa */}
              <div className="flex flex-wrap items-center gap-1.5 pl-7">
                <label
                  htmlFor={`stage-label-${stage.id}`}
                  className="text-micro font-medium text-dim"
                >
                  Etiqueta da etapa:
                </label>
                <select
                  id={`stage-label-${stage.id}`}
                  value={stage.labelId}
                  onChange={(e) => updateLabel(index, e.target.value)}
                  className="rounded-control border border-line bg-surface px-2 py-1 text-micro text-ink outline-none focus:border-brand"
                >
                  <option value="">Nenhuma</option>
                  {labels
                    .filter((label) => label.id === stage.labelId || !usadas.has(label.id))
                    .map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                </select>
                <span className="text-micro text-dim">
                  {stage.labelId
                    ? 'aplicada ao contato ao mover o card para cá'
                    : 'o card só se move na mão'}
                </span>
              </div>

              {/* Atalho de Cores Rápidas */}
              <div className="flex items-center gap-1.5 pl-7">
                <span className="text-micro text-dim">Cores sugeridas:</span>
                <div className="flex items-center gap-1">
                  {STAGE_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => updateColor(index, preset.value)}
                      title={preset.name}
                      style={{ backgroundColor: preset.value }}
                      className={cn(
                        'size-3.5 rounded-full ring-1 ring-white/20 transition-transform hover:scale-125',
                        stage.color.toLowerCase() === preset.value.toLowerCase() &&
                          'ring-2 ring-brand scale-110',
                      )}
                    />
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* Botão Adicionar Nova Etapa */}
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="size-3.5" />}
          onClick={addStage}
          className="border-dashed"
        >
          Adicionar nova etapa ao funil
        </Button>

        {/* Rodapé */}
        <div className="mt-2 flex items-center justify-end gap-2.5 border-t border-line-soft pt-3">
          <Button variant="ghost" type="button" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
