'use client';

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface UnsavedChangesBarProps {
  readonly show: boolean;
  readonly isSaving?: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly message?: string;
  readonly className?: string;
}

/**
 * Barra fixa inferior flutuante exibida quando o formulário possui alterações não salvas.
 * Segue o padrão de alto padrão SaaS do Dashboard e Contatos.
 */
export function UnsavedChangesBar({
  show,
  isSaving = false,
  onSave,
  onDiscard,
  message = 'Você possui alterações não salvas.',
  className,
}: UnsavedChangesBarProps) {
  if (!show) return null;

  return (
    <div
      role="region"
      aria-label="Aviso de alterações não salvas"
      className={cn(
        'fixed bottom-6 inset-x-4 mx-auto max-w-xl z-40',
        'animate-in fade-in slide-in-from-bottom-4 duration-200',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 p-3.5 shadow-xl backdrop-blur-md dark:shadow-2xl dark:shadow-black/50">
        <div className="flex items-center gap-2.5 min-w-0 pl-1.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <AlertCircle className="size-4" />
          </div>
          <span className="truncate text-body font-medium text-ink">
            {message}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onDiscard}
            disabled={isSaving}
          >
            Descartar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={isSaving}
          >
            {isSaving ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </div>
      </div>
    </div>
  );
}
