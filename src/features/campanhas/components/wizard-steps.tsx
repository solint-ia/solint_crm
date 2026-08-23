'use client';

import { cn } from '@/lib/cn';

const STEPS = [
  { id: 1, label: 'Publico' },
  { id: 2, label: 'Template' },
  { id: 3, label: 'Variáveis' },
  { id: 4, label: 'Agendamento' },
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
      {STEPS.map((item, index) => (
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
              {current > item.id ? '\u2713' : item.id}
            </span>
            <span
              className={cn(
                'text-body font-semibold',
                current === item.id ? 'text-ink' : 'text-dim',
              )}
            >
              {item.label}
            </span>
          </button>
          {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-line" /> : null}
        </li>
      ))}
    </ol>
  );
}
