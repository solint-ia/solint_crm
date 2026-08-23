import { Plus } from 'lucide-react';
import type { Label } from '@/core/domain/label';
import { LabelChip } from '@/components/domain/label-chip';
import { Button } from '@/components/ui/button';
import { planned } from '@/components/ui/planned';

interface LabelsSectionProps {
  readonly labels: readonly Label[];
}

export function LabelsSection({ labels }: LabelsSectionProps) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-title font-bold text-ink tracking-tight">
            Etiquetas e marcadores
          </h3>
          <p className="text-body text-muted">
            Organize contatos, conversas e oportunidades no kanban com tags visuais.
          </p>
        </div>
        <Button size="sm" icon={<Plus className="size-3.5" />} {...planned('Criar uma etiqueta')}>
          Nova etiqueta
        </Button>
      </div>

      <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
        <div className="divide-y divide-line-soft">
          {labels.map((label) => (
            <div
              key={label.id}
              className="flex items-center justify-between gap-4 p-3.5 transition-colors hover:bg-surface-2/60"
            >
              <div className="flex items-center gap-3">
                <LabelChip label={label} />
                {label.description ? (
                  <span className="text-body text-muted">{label.description}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" {...planned('Editar esta etiqueta')}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" className="text-dim hover:text-red-text" {...planned('Arquivar esta etiqueta')}>
                  Arquivar
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
