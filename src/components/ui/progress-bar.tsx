import { cn } from '@/lib/cn';

interface ProgressBarProps {
  readonly value: number;
  readonly max?: number;
  readonly label: string;
  readonly colorVar?: string;
  readonly className?: string;
}

export function ProgressBar({ value, max = 100, label, colorVar, className }: ProgressBarProps) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: colorVar ?? 'var(--color-brand)' }}
      />
    </div>
  );
}
