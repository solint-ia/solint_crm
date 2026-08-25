'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, Trash2, X } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/cn';

export interface ConfirmModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly variant?: 'danger' | 'warning' | 'primary';
  readonly icon?: 'trash' | 'alert' | 'warning';
  readonly isLoading?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void | Promise<void>;
  readonly className?: string;
}

/**
 * Modal de confirmação padrão para ações destrutivas ou sensíveis no CRM.
 * Substitui o confirm() nativo do navegador com visual B2B profissional,
 * acessibilidade por teclado (Esc, Enter) e estados de carregamento.
 */
export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Excluir',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  icon = 'trash',
  isLoading = false,
  onClose,
  onConfirm,
  className,
}: ConfirmModalProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setInternalLoading(false);
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLoading && !internalLoading) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      previouslyFocused?.focus();
    };
  }, [open, onClose, isLoading, internalLoading]);


  if (!open) return null;

  const busy = isLoading || internalLoading;

  const handleConfirm = async () => {
    try {
      const result = onConfirm();
      if (result instanceof Promise) {
        setInternalLoading(true);
        await result;
      }
    } finally {
      setInternalLoading(false);
    }
  };

  const IconComponent =
    icon === 'trash' ? Trash2 : icon === 'warning' ? AlertTriangle : AlertCircle;

  const iconColors =
    variant === 'danger'
      ? 'bg-red-soft text-red-text border-red-line/50'
      : variant === 'warning'
        ? 'bg-amber-soft text-amber-text border-amber-border/50'
        : 'bg-blue-soft text-blue-text border-blue-border/50';

  const confirmBtnVariant =
    variant === 'danger' ? 'danger' : variant === 'warning' ? 'primary' : 'primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={() => {
          if (!busy) onClose();
        }}
        aria-hidden="true"
      />

      {/* Painel do Modal */}
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-desc"
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-line bg-surface p-6 shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-150',
          className,
        )}
      >
        {/* Botão Fechar no canto superior */}
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Fechar"
          className="absolute right-4 top-4 rounded-control p-1 text-dim transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-4">
          {/* Ícone de Destaque */}
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full border shadow-2xs',
              iconColors,
            )}
          >
            <IconComponent className="size-5 stroke-[2.2]" />
          </div>

          {/* Textos */}
          <div className="flex-1 min-w-0 pt-0.5">
            <h2
              id="confirm-modal-title"
              className="font-display text-title font-bold text-ink tracking-tight"
            >
              {title}
            </h2>

            {description && (
              <div id="confirm-modal-desc" className="mt-2 text-body text-muted leading-relaxed">
                {description}
              </div>
            )}
          </div>
        </div>

        {/* Rodapé com Ações */}
        <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-line-soft pt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>

          <Button
            variant={confirmBtnVariant}
            size="sm"
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? 'Processando...' : confirmLabel}
          </Button>

        </div>
      </div>
    </div>
  );
}
