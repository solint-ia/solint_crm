'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { ArrowRight, CornerDownLeft, MessageSquare, Search, User } from 'lucide-react';
import type { NavItem } from '@/config/navigation';
import type { SearchHit } from '@/app/api/busca/route';
import { cn } from '@/lib/cn';

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Itens de navegação que o usuário tem permissão de ver (RBAC no servidor). */
  readonly navItems: readonly NavItem[];
}

type EntryKind = SearchHit['kind'] | 'pagina';
type Entry = Omit<SearchHit, 'kind'> & { readonly kind: EntryKind; readonly group: string };

const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;

const ICONS = {
  conversa: MessageSquare,
  contato: User,
  pagina: ArrowRight,
} as const;

/**
 * Busca global e navegação por teclado.
 *
 * Existe porque a topbar já anunciava `⌘K` — uma promessa visual sem
 * implementação é pior que não ter atalho nenhum: o usuário tenta, falha e
 * conclui que o sistema travou.
 */
export function CommandPalette({ open, onClose, navItems }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  // Páginas são filtradas no cliente: a lista é curta e já veio com a sessão.
  const pages: readonly Entry[] = useMemo(() => {
    const term = query.trim().toLowerCase();
    return navItems
      .filter((item) => !term || item.label.toLowerCase().includes(term))
      .map((item) => ({
        id: item.id,
        kind: 'pagina' as const,
        group: 'Ir para',
        title: item.label,
        subtitle: item.href,
        href: item.href,
      }));
  }, [navItems, query]);

  const entries: readonly Entry[] = useMemo(
    () => [
      ...pages,
      ...hits.map((hit) => ({
        ...hit,
        group: hit.kind === 'conversa' ? 'Conversas' : 'Contatos',
      })),
    ],
    [pages, hits],
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHits([]);
    setActive(0);
    const focus = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(focus);
  }, [open]);

  // Busca no servidor, com debounce e cancelamento — digitar rápido não deve
  // deixar uma resposta antiga sobrescrever a mais recente.
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < MIN_QUERY) {
      setHits([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/busca?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { hits?: SearchHit[] };
        setHits(data.hits ?? []);
      } catch {
        // Requisição cancelada ou rede fora: mantém o último resultado válido.
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open]);

  useEffect(() => {
    setActive(0);
  }, [entries.length]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href as Route);
    },
    [onClose, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (entries.length ? (index + 1) % entries.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (entries.length ? (index - 1 + entries.length) % entries.length : 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = entries[active];
      if (target) go(target.href);
    }
  };

  if (!open) return null;

  let lastGroup = '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/25 p-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-float border border-line bg-surface shadow-xl"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-dim" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar conversas, contatos ou telas..."
            aria-label="Buscar no CRM"
            aria-controls="command-results"
            className="h-12 flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-dim"
          />
          <kbd className="shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-micro font-semibold text-dim">
            Esc
          </kbd>
        </div>

        <ul id="command-results" className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {entries.map((entry, index) => {
            const Icon = ICONS[entry.kind];
            const showGroup = entry.group !== lastGroup;
            lastGroup = entry.group;

            return (
              <li key={`${entry.group}-${entry.id}`}>
                {showGroup ? (
                  <p className="px-4 pt-2.5 pb-1 text-micro font-semibold tracking-wide text-dim uppercase">
                    {entry.group}
                  </p>
                ) : null}
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(entry.href)}
                  aria-current={index === active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors',
                    index === active ? 'bg-selected' : 'hover:bg-surface-2',
                  )}
                >
                  <Icon className="size-3.5 shrink-0 text-dim" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui text-ink">{entry.title}</span>
                    <span className="block truncate text-meta text-muted">{entry.subtitle}</span>
                  </span>
                  {index === active ? (
                    <CornerDownLeft className="size-3.5 shrink-0 text-dim" />
                  ) : null}
                </button>
              </li>
            );
          })}

          {entries.length === 0 ? (
            <li className="px-4 py-8 text-center text-body text-muted">
              {loading
                ? 'Buscando...'
                : query.trim().length < MIN_QUERY
                  ? `Digite ao menos ${MIN_QUERY} letras para buscar.`
                  : `Nada encontrado para "${query.trim()}".`}
            </li>
          ) : null}
        </ul>

        <footer className="flex items-center gap-4 border-t border-line px-4 py-2 text-meta text-dim">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-line px-1 font-mono">↑</kbd>
            <kbd className="rounded border border-line px-1 font-mono">↓</kbd>
            navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-line px-1 font-mono">↵</kbd>
            abrir
          </span>
        </footer>
      </div>
    </div>
  );
}
