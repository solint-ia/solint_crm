import { Plus } from 'lucide-react';
import type { CannedResponse } from '@/core/domain/settings';
import { Button } from '@/components/ui/button';
import { planned } from '@/components/ui/planned';

interface CannedResponsesSectionProps {
  readonly cannedResponses: readonly CannedResponse[];
}

export function CannedResponsesSection({ cannedResponses }: CannedResponsesSectionProps) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
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
        <Button size="sm" icon={<Plus className="size-3.5" />} {...planned('Criar uma resposta rápida')}>
          Nova resposta rápida
        </Button>
      </div>

      <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
        <div className="divide-y divide-line-soft">
          {cannedResponses.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-2 p-4 transition-colors hover:bg-surface-2/60"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-control bg-accent-soft border border-accent-line/40 px-2.5 py-0.5 font-mono text-meta font-bold text-accent-soft-text">
                  {item.shortcut}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" {...planned('Editar esta resposta rápida')}>
                    Editar
                  </Button>
                  <Button variant="ghost" size="sm" className="text-dim hover:text-red-text" {...planned('Excluir esta resposta rápida')}>
                    Excluir
                  </Button>
                </div>
              </div>
              <p className="text-ui text-ink leading-relaxed font-normal">{item.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
