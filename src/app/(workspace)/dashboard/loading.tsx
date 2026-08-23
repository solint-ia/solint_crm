import { PageLoading } from '@/components/layout/page-loading';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <PageLoading label="Carregando a visão geral do atendimento">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-64 rounded-control" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-surface lg:col-span-2" />
        <Skeleton className="h-64 rounded-surface" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-52 rounded-surface" />
        ))}
      </div>
    </PageLoading>
  );
}
