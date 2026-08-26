'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock,
  History,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { SortKey } from '../hooks/use-inbox';

interface InboxSortMenuProps {
  readonly sort: SortKey;
  readonly onChange: (sort: SortKey) => void;
}

const SORT_OPTIONS: readonly {
  readonly id: SortKey;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof Clock;
}[] = [
  {
    id: 'recentes',
    label: 'Mais recentes',
    description: 'Atividade mais recente primeiro',
    icon: Clock,
  },
  {
    id: 'antigas',
    label: 'Mais antigas',
    description: 'Aguardando há mais tempo',
    icon: History,
  },
  {
    id: 'prioridade',
    label: 'Por prioridade',
    description: 'Urgentes e altas no topo',
    icon: AlertCircle,
  },
];

export function InboxSortMenu({ sort, onChange }: InboxSortMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentOption = SORT_OPTIONS.find((opt) => opt.id === sort) ?? SORT_OPTIONS[0]!;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const onClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Ordenar lista: ${currentOption.label}`}
        title={`Ordenar lista: ${currentOption.label}`}
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-all shadow-2xs',
          open
            ? 'border-brand bg-brand/10 text-brand'
            : 'border-line bg-surface text-ink hover:bg-surface-2 hover:border-line-strong',
        )}
      >
        <SlidersHorizontal className="size-3.5 text-muted" />
        <span className="font-semibold text-[11px]">{currentOption.label.replace('Mais ', '')}</span>
        <ChevronDown
          className={cn(
            'size-3 text-muted transition-transform duration-150',
            open ? 'rotate-180 text-brand' : '',
          )}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Opções de ordenação"
          className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-2xl border border-line bg-surface/98 backdrop-blur-xl p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted border-b border-line-soft mb-1">
            Ordenar conversas
          </div>

          <div className="space-y-0.5">
            {SORT_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isSelected = option.id === sort;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-all',
                    isSelected
                      ? 'bg-brand/12 font-semibold text-brand border border-brand/20 shadow-xs'
                      : 'text-ink hover:bg-surface-2 border border-transparent',
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon
                      className={cn(
                        'size-3.5 shrink-0',
                        isSelected ? 'text-brand' : 'text-muted',
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </div>

                  {isSelected && <Check className="size-3.5 shrink-0 text-brand" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
