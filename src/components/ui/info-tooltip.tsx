'use client';

import { useId, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * O balãozinho de interrogação que explica um indicador.
 *
 * Antes a explicação ia no atributo `title` do HTML. Ela existia — e não
 * aparecia: o `title` nativo demora cerca de um segundo para surgir, some ao
 * menor movimento do mouse, não abre no toque (todo o mobile ficava sem
 * explicação nenhuma) e não abre no teclado. Na prática, os cartões tinham um
 * ícone de ajuda que não ajudava ninguém.
 *
 * Aqui o gatilho é um `button`: abre no passar do mouse, no foco pelo teclado e
 * no toque, e fecha com `Escape`. O texto é ligado ao botão por
 * `aria-describedby`, então o leitor de tela anuncia a definição junto com o
 * indicador em vez de ler "botão de ajuda" e parar aí.
 */
export function InfoTooltip({
  text,
  label,
  className,
}: {
  readonly text: string;
  /** O que o balão explica, para quem ouve a tela em vez de ver. */
  readonly label: string;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-label={`O que significa ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((atual) => !atual)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className="flex size-4 items-center justify-center rounded-full text-dim transition-colors hover:text-brand focus-visible:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <HelpCircle className="size-3.5" />
      </button>

      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute top-full left-0 z-50 mt-1.5 w-64 rounded-xl border border-line bg-surface/95 dark:bg-surface-2/95 p-3 text-left text-xs leading-relaxed font-normal text-ink shadow-xl backdrop-blur-md animate-in fade-in duration-100 sm:w-72"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
