'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface MenuProps {
  /** Conteúdo do botão que abre o painel. */
  readonly trigger: ReactNode;
  readonly label: string;
  /** Recebe `close` para que uma escolha feche o painel sem estado extra. */
  readonly children: (close: () => void) => ReactNode;
  readonly align?: 'left' | 'right';
  readonly className?: string;
  readonly panelClassName?: string;
  readonly disabled?: boolean;
}

/**
 * Painel flutuante ancorado num botão.
 *
 * Existe porque a caixa de entrada precisava de quatro deles — prioridade,
 * etiquetas, filtros, transferir — e cada um reimplementado à mão erraria um
 * detalhe diferente: fechar no Escape, fechar ao clicar fora, devolver o foco,
 * anunciar o estado. Aqui isso é uma vez só.
 */
export function Menu({
  trigger,
  label,
  children,
  align = 'right',
  className,
  panelClassName,
  disabled,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Fechar sem devolver o foco deixaria o teclado no início da página.
      triggerRef.current?.focus();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        className="disabled:cursor-not-allowed disabled:opacity-50"
      >
        {trigger}
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            id={panelId}
            role="dialog"
            aria-label={label}
            className={cn(
              'absolute top-full z-40 mt-1.5 min-w-52 overflow-hidden rounded-float border border-line bg-surface shadow-xl',
              align === 'right' ? 'right-0' : 'left-0',
              panelClassName,
            )}
          >
            {children(() => {
              setOpen(false);
              triggerRef.current?.focus();
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Linha selecionável de um painel. */
export function MenuItem({
  children,
  onClick,
  selected,
  disabled,
  className,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-body transition-colors',
        selected ? 'bg-accent-soft font-semibold text-brand' : 'text-ink hover:bg-surface-2',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function MenuHeader({ children }: { readonly children: ReactNode }) {
  return (
    <p className="border-b border-line px-3 py-2 text-micro font-semibold tracking-wide text-dim uppercase">
      {children}
    </p>
  );
}
