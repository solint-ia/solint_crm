import { PageLoading } from '@/components/layout/page-loading';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';

export default function CampanhasLoading() {
  return (
    <PageLoading label="Carregando as campanhas">
      <Skeleton className="mb-4 h-28 rounded-surface" />
      <SkeletonTable rows={5} columns={6} />
    </PageLoading>
  );
}
