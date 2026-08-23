import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly className?: string;
}

/** Estado vazio padrão. Microcopia conforme SKILL.md secao 6. */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-surface border border-dashed border-line px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="text-dim">{icon}</div> : null}
      <p className="font-display text-ui font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-sm text-body text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * Estado vazio leve, para listas que já vivem dentro de um Card.
 * A moldura tracejada do EmptyState duplicaria a borda do cartão.
 */
export function EmptyHint({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <p className={cn('py-2 text-meta text-dim', className)}>{children}</p>
  );
}
