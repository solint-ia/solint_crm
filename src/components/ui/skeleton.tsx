import { cn } from '@/lib/cn';

/**
 * Placeholder de carregamento.
 *
 * Um bloco cinza pulsando só ajuda se tiver o formato do conteúdo que vai
 * chegar — caso contrário a tela "pula" quando os dados carregam. Por isso cada
 * rota monta seu próprio esqueleto com estas peças, em vez de um spinner único.
 *
 * A animação respeita `prefers-reduced-motion` (definido em globals.css).
 */
export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block animate-pulse rounded-control bg-surface-2', className)}
    />
  );
}

/** Linhas de texto de larguras irregulares — leem como parágrafo, não como barra. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  readonly lines?: number;
  readonly className?: string;
}) {
  const widths = ['w-full', 'w-11/12', 'w-4/5', 'w-3/4', 'w-2/3'];
  return (
    <span className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3', widths[index % widths.length])} />
      ))}
    </span>
  );
}

/** Envelope acessível: anuncia o carregamento a leitores de tela uma única vez. */
export function LoadingRegion({
  label,
  children,
  className,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Cartão genérico da grade de conteúdo. */
export function SkeletonCard({ className }: { readonly className?: string }) {
  return (
    <div className={cn('rounded-surface border border-line bg-surface p-4.5', className)}>
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="mt-3 h-7 w-2/3" />
      <SkeletonText lines={2} className="mt-4" />
    </div>
  );
}

/** Linhas de tabela com a mesma altura das reais, para não haver salto de layout. */
export function SkeletonTable({
  rows = 6,
  columns = 5,
}: {
  readonly rows?: number;
  readonly columns?: number;
}) {
  return (
    <div className="overflow-hidden rounded-surface border border-line bg-surface">
      <div className="flex gap-4 border-b border-line px-4 py-3">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 border-b border-line-soft px-4 py-3.5 last:border-0">
          {Array.from({ length: columns }, (_, col) => (
            <Skeleton key={col} className={cn('h-3 flex-1', col === 0 && 'max-w-40')} />
          ))}
        </div>
      ))}
    </div>
  );
}
