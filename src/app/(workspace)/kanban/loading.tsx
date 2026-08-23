import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';

export default function KanbanLoading() {
  return (
    <LoadingRegion
      label="Carregando o funil de oportunidades"
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-15 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-8 w-72 rounded-control" />
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-6 py-3">
        <Skeleton className="h-8 w-44 rounded-control" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-36 rounded-control" />
          <Skeleton className="h-8 w-40 rounded-control" />
        </div>
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden bg-app p-4">
        {Array.from({ length: 5 }, (_, col) => (
          <div key={col} className="flex w-72 shrink-0 flex-col gap-2.5">
            <Skeleton className="h-9 rounded-control" />
            {Array.from({ length: 3 - (col % 2) }, (_, card) => (
              <Skeleton key={card} className="h-28 rounded-surface" />
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}
