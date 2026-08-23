'use client';

import { cn } from '@/lib/cn';

interface ToggleProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
}

/** Switch acessivel: role=switch + rotulo obrigatório (WCAG 4.1.2). */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-toggle-off',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-xs ring-0 transition-transform duration-200 ease-in-out',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
