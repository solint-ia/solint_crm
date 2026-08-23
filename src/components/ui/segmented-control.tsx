'use client';

import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly count?: number;
}

interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/** Grupo de abas controlado, com semantica de tablist. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('inline-flex gap-1 rounded-control bg-surface-2 p-1', className)}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={cn(
              'rounded-control font-semibold transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-meta' : 'px-3 py-1.5 text-body',
              active ? 'bg-surface text-brand shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
            {typeof option.count === 'number' ? (
              <span className="ml-1.5 text-micro text-dim">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
