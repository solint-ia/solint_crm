'use client';

import { Filter, X } from 'lucide-react';
import type { Channel } from '@/core/domain/channel';
import { CHANNELS, CHANNEL_REGISTRY } from '@/core/domain/channel';
import type { Priority } from '@/core/domain/conversation';
import { PRIORITIES } from '@/core/domain/conversation';
import type { Label } from '@/core/domain/label';
import { Menu, MenuHeader } from '@/components/ui/menu';
import { PRIORITY_LABEL } from '@/components/domain/presentation-maps';
import { TONE_DOT_CLASSES } from '@/components/ui/tone';
import { cn } from '@/lib/cn';
import { activeFilterCount, type InboxFilters } from '../hooks/use-inbox';

interface InboxFiltersMenuProps {
  readonly filters: InboxFilters;
  readonly labels: readonly Label[];
  readonly onChange: (filters: InboxFilters) => void;
}

/**
 * Filtros combináveis da lista.
 *
 * Combinam por E, e o contador no gatilho é o que impede o erro clássico de
 * fila: achar que a caixa está vazia quando na verdade um filtro esquecido está
 * escondendo tudo. É também por isso que "limpar" fica sempre visível quando há
 * algum ativo.
 */
export function InboxFiltersMenu({ filters, labels, onChange }: InboxFiltersMenuProps) {
  const count = activeFilterCount(filters);

  const patch = (next: Partial<InboxFilters>) => onChange({ ...filters, ...next });

  return (
    <Menu
      align="right"
      label={count > 0 ? `Filtros, ${count} ativos` : 'Filtros'}
      panelClassName="w-64"
      trigger={
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-control border px-2 py-1 text-meta font-semibold transition-colors',
            count > 0
              ? 'border-brand bg-accent-soft text-brand'
              : 'border-line text-muted hover:bg-surface-2 hover:text-ink',
          )}
        >
          <Filter className="size-3" />
          {count > 0 ? count : 'Filtros'}
        </span>
      }
    >
      {() => (
        <div className="max-h-[70vh] overflow-y-auto">
          <MenuHeader>Canal</MenuHeader>
          <div className="flex flex-wrap gap-1 p-2">
            {CHANNELS.map((channel) => (
              <Chip
                key={channel}
                active={filters.channel === channel}
                onClick={() =>
                  patch({ channel: filters.channel === channel ? undefined : (channel as Channel) })
                }
              >
                {CHANNEL_REGISTRY[channel].label}
              </Chip>
            ))}
          </div>

          <MenuHeader>Prioridade</MenuHeader>
          <div className="flex flex-wrap gap-1 p-2">
            {PRIORITIES.map((priority) => (
              <Chip
                key={priority}
                active={filters.priority === priority}
                onClick={() =>
                  patch({
                    priority: filters.priority === priority ? undefined : (priority as Priority),
                  })
                }
              >
                {PRIORITY_LABEL[priority]}
              </Chip>
            ))}
          </div>

          {labels.length > 0 ? (
            <>
              <MenuHeader>Etiqueta</MenuHeader>
              <div className="flex flex-wrap gap-1 p-2">
                {labels.map((label) => (
                  <Chip
                    key={label.id}
                    active={filters.labelId === label.id}
                    onClick={() =>
                      patch({ labelId: filters.labelId === label.id ? undefined : label.id })
                    }
                  >
                    <span
                      className={cn('size-1.5 rounded-full', TONE_DOT_CLASSES[label.tone])}
                    />
                    {label.name}
                  </Chip>
                ))}
              </div>
            </>
          ) : null}

          <MenuHeader>Situação</MenuHeader>
          <div className="flex flex-col gap-1 p-2">
            <Check
              checked={filters.unreadOnly === true}
              onChange={(value) => patch({ unreadOnly: value || undefined })}
            >
              Só não lidas
            </Check>
            <Check
              checked={filters.slaBreached === true}
              onChange={(value) => patch({ slaBreached: value || undefined })}
            >
              Só com SLA estourado
            </Check>
          </div>

          {count > 0 ? (
            <button
              type="button"
              onClick={() => onChange({})}
              className="flex w-full items-center justify-center gap-1.5 border-t border-line px-3 py-2 text-meta font-semibold text-brand transition-colors hover:bg-surface-2"
            >
              <X className="size-3" />
              Limpar {count} {count === 1 ? 'filtro' : 'filtros'}
            </button>
          ) : null}
        </div>
      )}
    </Menu>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-meta font-medium transition-colors',
        active
          ? 'border-brand bg-accent-soft font-semibold text-brand'
          : 'border-line text-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1 text-body text-ink transition-colors hover:bg-surface-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-brand"
      />
      {children}
    </label>
  );
}
