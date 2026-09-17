'use client';

import { cn } from '@/lib/cn';

export const WIZARD_STEPS = [
  { id: 1, label: 'Caixa e template' },
  { id: 2, label: 'Variáveis' },
  { id: 3, label: 'Público' },
  { id: 4, label: 'Revisão e disparo' },
] as const;

export function WizardSteps({
  current,
  onSelect,
}: {
  readonly current: number;
  readonly onSelect: (step: number) => void;
}) {
  return (
    <ol className="mb-4 flex items-center gap-2">
      {WIZARD_STEPS.map((item, index) => (
        <li key={item.id} className="flex flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className="flex items-center gap-2"
            aria-current={current === item.id ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-meta font-bold',
                current === item.id && 'border-brand bg-brand text-white',
                current > item.id && 'border-green-line bg-green-soft text-green-text',
                current < item.id && 'border-line bg-surface text-dim',
              )}
            >
              {current > item.id ? '✓' : item.id}
            </span>
            <span
              className={cn(
                'hidden text-body font-semibold sm:inline',
                current === item.id ? 'text-ink' : 'text-dim',
              )}
            >
              {item.label}
            </span>
          </button>
          {index < WIZARD_STEPS.length - 1 ? <span className="h-px flex-1 bg-line" /> : null}
        </li>
      ))}
    </ol>
  );
}
