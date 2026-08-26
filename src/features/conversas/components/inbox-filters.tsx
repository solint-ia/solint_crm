'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Filter,
  Mail,
  MessageSquare,
  RotateCcw,
  X,
} from 'lucide-react';
import type { Channel } from '@/core/domain/channel';
import { CHANNELS, describeChannel } from '@/core/domain/channel';
import type { Priority } from '@/core/domain/conversation';
import { PRIORITIES } from '@/core/domain/conversation';
import type { Label } from '@/core/domain/label';
import { PRIORITY_LABEL } from '@/components/domain/presentation-maps';
import { TONE_DOT_CLASSES } from '@/components/ui/tone';
import { cn } from '@/lib/cn';
import { activeFilterCount, type InboxFilters } from '../hooks/use-inbox';

interface InboxFiltersMenuProps {
  readonly filters: InboxFilters;
  readonly labels: readonly Label[];
  readonly onChange: (filters: InboxFilters) => void;
}

const CHANNEL_ICONS: Readonly<Record<Channel, typeof MessageSquare>> = {
  whatsapp: MessageSquare,
};

const CHANNEL_COLORS: Readonly<Record<Channel, string>> = {
  whatsapp: 'text-emerald-500 bg-emerald-500/10',
};

const PRIORITY_STYLES: Readonly<
  Record<Priority, { readonly dot: string; readonly activeBg: string; readonly text: string }>
> = {
  baixa: {
    dot: 'bg-slate-400',
    activeBg: 'bg-slate-500/15 border-slate-400/40 text-slate-700 dark:text-slate-200',
    text: 'text-slate-600 dark:text-slate-300',
  },
  media: {
    dot: 'bg-blue-500',
    activeBg: 'bg-blue-500/15 border-blue-500/40 text-blue-700 dark:text-blue-300',
    text: 'text-blue-600 dark:text-blue-400',
  },
  alta: {
    dot: 'bg-amber-500',
    activeBg: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300',
    text: 'text-amber-600 dark:text-amber-400',
  },
  urgente: {
    dot: 'bg-rose-500',
    activeBg: 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300',
    text: 'text-rose-600 dark:text-rose-400',
  },
};

export function InboxFiltersMenu({ filters, labels, onChange }: InboxFiltersMenuProps) {
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(filters);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<{
    top: number;
    left: number;
    width: number;
  }>({
    top: 0,
    left: 0,
    width: 320,
  });

  const patch = (next: Partial<InboxFilters>) => onChange({ ...filters, ...next });

  const clearAll = () => {
    // Preserva o inboxId se estiver selecionado via sidebar, mas limpa os filtros secundários
    onChange(filters.inboxId ? { inboxId: filters.inboxId } : {});
  };

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = Math.min(320, window.innerWidth - 24);

      // Descobre a borda esquerda segura: se a rail estiver visível (~64px),
      // o painel deve começar no mínimo a partir de 72px para nunca ficar sob a barra
      const railEl = document.querySelector('nav[aria-label="Navegação principal"]');
      const railRect = railEl?.getBoundingClientRect();
      const minLeft = railRect && railRect.width > 0 ? railRect.right + 8 : 12;
      const maxLeft = window.innerWidth - panelWidth - 12;

      // Alinha à esquerda com segurança a partir da coluna de conversas
      let targetLeft = rect.left - 60;
      if (targetLeft < minLeft) {
        targetLeft = minLeft;
      }
      if (targetLeft > maxLeft) {
        targetLeft = maxLeft;
      }

      setPanelPosition({
        top: rect.bottom + 8,
        left: Math.round(targetLeft),
        width: panelWidth,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

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
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  return (
    <div className="relative">
      {/* Botão de Disparo */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={count > 0 ? `Filtros, ${count} ativos` : 'Filtros'}
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-all shadow-2xs',
          count > 0 || open
            ? 'border-brand bg-brand/10 font-semibold text-brand'
            : 'border-line bg-surface text-ink hover:bg-surface-2 hover:border-line-strong',
        )}
      >
        <Filter className={cn('size-3.5', count > 0 ? 'text-brand' : 'text-muted')} />
        <span className="font-semibold text-[11px]">Filtros</span>
        {count > 0 && (
          <span className="flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white shadow-xs">
            {count}
          </span>
        )}
      </button>

      {/* Backdrop e Painel Flutuante com Posição Fixa Segura */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-label="Filtros avançados"
            style={{
              top: `${panelPosition.top}px`,
              left: `${panelPosition.left}px`,
              width: `${panelPosition.width}px`,
            }}
            className="fixed z-50 rounded-2xl border border-line bg-surface/98 backdrop-blur-xl p-3 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
          >
          {/* Cabeçalho do Painel */}
          <div className="flex items-center justify-between border-b border-line pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-brand">
                <Filter className="size-4" />
              </span>
              <div>
                <h4 className="font-display text-xs font-bold text-ink tracking-tight">
                  Filtros de conversas
                </h4>
                <p className="text-[10px] text-muted">
                  {count > 0 ? `${count} filtro${count === 1 ? '' : 's'} ativo${count === 1 ? '' : 's'}` : 'Refine a listagem'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {count > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted hover:text-brand hover:bg-brand/10 transition-colors"
                  title="Limpar todos os filtros"
                >
                  <RotateCcw className="size-3" />
                  <span>Limpar</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-muted hover:text-ink hover:bg-surface-2 transition-colors"
                aria-label="Fechar filtros"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-[65vh] overflow-y-auto space-y-3.5 pr-0.5">
            {/* 1. Canais */}
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">
                Canal de atendimento
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {CHANNELS.map((channel) => {
                  const Icon = CHANNEL_ICONS[channel];
                  const active = filters.channel === channel;
                  const colorClasses = CHANNEL_COLORS[channel];

                  return (
                    <button
                      key={channel}
                      type="button"
                      onClick={() =>
                        patch({ channel: active ? undefined : (channel as Channel) })
                      }
                      className={cn(
                        'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all text-left',
                        active
                          ? 'border-brand bg-brand/12 text-brand font-semibold shadow-xs ring-1 ring-brand/20'
                          : 'border-line bg-surface text-ink hover:bg-surface-2 hover:border-line-strong',
                      )}
                    >
                      <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md', colorClasses)}>
                        <Icon className="size-3" />
                      </span>
                      <span className="truncate flex-1">{describeChannel(channel).label}</span>
                      {active && <Check className="size-3 shrink-0 text-brand" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Prioridade */}
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">
                Prioridade
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {PRIORITIES.map((priority) => {
                  const active = filters.priority === priority;
                  const style = PRIORITY_STYLES[priority];

                  return (
                    <button
                      key={priority}
                      type="button"
                      onClick={() =>
                        patch({ priority: active ? undefined : (priority as Priority) })
                      }
                      className={cn(
                        'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all text-left',
                        active
                          ? `${style.activeBg} font-semibold shadow-xs ring-1 ring-brand/20`
                          : 'border-line bg-surface text-ink hover:bg-surface-2 hover:border-line-strong',
                      )}
                    >
                      <span className={cn('size-2 shrink-0 rounded-full', style.dot)} />
                      <span className="truncate flex-1">{PRIORITY_LABEL[priority]}</span>
                      {active && <Check className="size-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Etiquetas (se existirem) */}
            {labels.length > 0 && (
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">
                  Etiquetas
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {labels.map((label) => {
                    const active = filters.labelId === label.id;
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() =>
                          patch({ labelId: active ? undefined : label.id })
                        }
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-all',
                          active
                            ? 'border-brand bg-brand/12 font-semibold text-brand shadow-xs'
                            : 'border-line bg-surface text-ink hover:bg-surface-2',
                        )}
                      >
                        <span className={cn('size-1.5 rounded-full', TONE_DOT_CLASSES[label.tone])} />
                        <span>{label.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4. Situação / Status especiais */}
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">
                Situação e SLA
              </span>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => patch({ unreadOnly: !filters.unreadOnly || undefined })}
                  className={cn(
                    'flex w-full items-center justify-between gap-2.5 rounded-xl border p-2 text-xs transition-all',
                    filters.unreadOnly
                      ? 'border-brand bg-brand/10 text-brand font-semibold'
                      : 'border-line bg-surface text-ink hover:bg-surface-2',
                  )}
                >
                  <div className="flex items-center gap-2 text-left">
                    <Mail className="size-4 text-muted" />
                    <div>
                      <div className="font-medium">Apenas não lidas</div>
                      <div className="text-[10px] text-muted">Exibe só com mensagens pendentes</div>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'relative h-4 w-7 rounded-full transition-colors',
                      filters.unreadOnly ? 'bg-blue-600' : 'bg-line-strong',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 size-3 rounded-full bg-white transition-transform',
                        filters.unreadOnly ? 'left-3.5' : 'left-0.5',
                      )}
                    />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => patch({ slaBreached: !filters.slaBreached || undefined })}
                  className={cn(
                    'flex w-full items-center justify-between gap-2.5 rounded-xl border p-2 text-xs transition-all',
                    filters.slaBreached
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold'
                      : 'border-line bg-surface text-ink hover:bg-surface-2',
                  )}
                >
                  <div className="flex items-center gap-2 text-left">
                    <AlertTriangle className="size-4 text-rose-500" />
                    <div>
                      <div className="font-medium">SLA estourado</div>
                      <div className="text-[10px] text-muted">Prazo de resposta ultrapassado</div>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'relative h-4 w-7 rounded-full transition-colors',
                      filters.slaBreached ? 'bg-rose-600' : 'bg-line-strong',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 size-3 rounded-full bg-white transition-transform',
                        filters.slaBreached ? 'left-3.5' : 'left-0.5',
                      )}
                    />
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Rodapé */}
          <div className="mt-3 border-t border-line pt-2.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full rounded-xl bg-brand py-2 text-center text-xs font-bold text-white shadow-sm hover:bg-brand/90 active:scale-[0.99] transition-all"
            >
              Ver resultados {count > 0 ? `(${count} filtros)` : ''}
            </button>
          </div>
        </div>
      </>
    )}
  </div>
);
}
