import { PageLoading } from '@/components/layout/page-loading';
import { Skeleton } from '@/components/ui/skeleton';

export default function ConfiguracoesLoading() {
  return (
    <PageLoading label="Carregando as configurações da conta">
      <div className="flex gap-6">
        <div className="hidden w-56 shrink-0 flex-col gap-1.5 md:flex">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-9 rounded-control" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <Skeleton className="h-[28rem] rounded-surface" />
        </div>
      </div>
    </PageLoading>
  );
}
