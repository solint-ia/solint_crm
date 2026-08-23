import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly padded?: boolean;
}

export function Card({ children, className, padded = true }: CardProps) {
  return (
    <section
      className={cn(
        'rounded-surface border border-line bg-surface transition-colors',
        padded && 'p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}

interface CardHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <header className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div>
        <h2 className="font-display text-title font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-body text-muted leading-normal">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
