import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { PageShell } from './page-shell';

/**
 * Esqueleto das telas com topbar.
 *
 * Reproduz a altura e as colunas reais do cabeçalho para que a tela não salte
 * quando os dados chegam — é o ponto de um skeleton, e o motivo de ele não ser
 * um spinner centralizado.
 */
export function PageLoading({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <LoadingRegion label={label} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-15 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-44" />
          <Skeleton className="h-2.5 w-64" />
        </div>
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-8.5 w-60 rounded-control" />
          <Skeleton className="size-9 rounded-control" />
          <Skeleton className="size-9 rounded-control" />
        </div>
      </header>

      <PageShell>{children}</PageShell>
    </LoadingRegion>
  );
}
