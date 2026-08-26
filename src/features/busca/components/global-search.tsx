'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { NavItem } from '@/config/navigation';
import { CommandPalette } from './command-palette';

/**
 * Campo de busca da topbar. Não é um input de verdade: é o gatilho da paleta,
 * porque o resultado da busca precisa de teclado, agrupamento e navegação —
 * coisas que um `<input>` solto não entrega.
 */
export function GlobalSearch({ navItems }: { readonly navItems: readonly NavItem[] }) {
  const [open, setOpen] = useState(false);
  const [shortcut, setShortcut] = useState('Ctrl K');

  useEffect(() => {
    // O atalho anunciado precisa ser o do sistema de quem está lendo.
    if (navigator.platform.toLowerCase().includes('mac')) setShortcut('⌘K');

    const onKeyDown = (event: KeyboardEvent) => {
      // `key` nem sempre vem preenchido: extensões de autofill/gerenciador de
      // senha disparam `keydown` sintético via APIs antigas que não o definem.
      if (event.key?.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buscar no CRM"
        aria-haspopup="dialog"
        className="relative hidden h-8.5 w-60 items-center gap-2 rounded-control border border-line bg-surface-2 pr-2.5 pl-8 text-left text-body text-dim transition-colors hover:border-brand/40 hover:text-muted focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none md:flex"
      >
        <Search className="pointer-events-none absolute left-3 size-3.5" />
        <span className="flex-1 truncate">Buscar no CRM...</span>
        <kbd className="pointer-events-none rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-micro font-semibold shadow-2xs">
          {shortcut}
        </kbd>
      </button>

      {/* No celular não há atalho de teclado nem espaço para o campo inteiro:
          sem este botão, a paleta ficaria inalcançável em metade dos aparelhos. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buscar no CRM"
        aria-haspopup="dialog"
        className="flex size-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-ink md:hidden"
      >
        <Search className="size-[18px]" />
      </button>

      <CommandPalette open={open} onClose={() => setOpen(false)} navItems={navItems} />
    </>
  );
}
