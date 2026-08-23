'use client';

import { GripVertical, Trash2 } from 'lucide-react';
import type { PipelineStage } from '@/core/domain/pipeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { planned } from '@/components/ui/planned';

interface StagesModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly stages: readonly PipelineStage[];
}

/** Configuração de etapas do funil (renomear, cor, ordem, ganho/perda). */
export function StagesModal({ open, onClose, stages }: StagesModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configurar etapas"
      description="Renomeie, reordene e defina quais etapas representam ganho ou perda."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={onClose} {...planned('Salvar a configuração das etapas')}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2">
        {stages.map((stage) => (
          <li
            key={stage.id}
            className="flex items-center gap-2 rounded-control border border-line px-3 py-2"
          >
            <GripVertical className="size-4 shrink-0 text-dim" />
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
            <input
              defaultValue={stage.name}
              readOnly
              aria-label={`Nome da etapa ${stage.name}`}
              title="Renomear etapa — em desenvolvimento, ainda não disponível."
              className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1.5 py-1 text-body text-ink outline-none focus:border-line focus:bg-surface-2"
            />
            {stage.isWon ? <Badge tone="green">Ganho</Badge> : null}
            {stage.isLost ? <Badge tone="slate">Perda</Badge> : null}
            <button
              type="button"
              aria-label={`Excluir etapa ${stage.name}`}
              {...planned('Excluir esta etapa do funil')}
              className="rounded-control p-1 text-dim transition-colors hover:bg-red-soft hover:text-red-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <Button variant="secondary" size="sm" className="mt-3" fullWidth {...planned('Adicionar uma etapa ao funil')}>
        Adicionar etapa
      </Button>
    </Modal>
  );
}
