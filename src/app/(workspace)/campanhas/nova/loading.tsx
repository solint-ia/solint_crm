import { PageLoading } from '@/components/layout/page-loading';
import { Skeleton } from '@/components/ui/skeleton';

export default function NovaCampanhaLoading() {
  return (
    <PageLoading label="Carregando o assistente de campanha">
      <Skeleton className="mb-5 h-12 max-w-2xl rounded-surface" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-96 rounded-surface lg:col-span-2" />
        <Skeleton className="h-96 rounded-surface" />
      </div>
    </PageLoading>
  );
}
