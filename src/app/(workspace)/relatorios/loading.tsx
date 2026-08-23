import { PageLoading } from '@/components/layout/page-loading';
import { Skeleton } from '@/components/ui/skeleton';

export default function RelatoriosLoading() {
  return (
    <PageLoading label="Carregando relatórios">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-80 rounded-control" />
        <Skeleton className="h-8 w-64 rounded-control" />
      </div>
      <Skeleton className="h-72 rounded-surface" />
    </PageLoading>
  );
}
