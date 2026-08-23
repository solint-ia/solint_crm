import { PageLoading } from '@/components/layout/page-loading';
import { Skeleton } from '@/components/ui/skeleton';

export default function PerfilLoading() {
  return (
    <PageLoading label="Carregando o seu perfil">
      <div className="grid max-w-5xl gap-5 md:grid-cols-2">
        <Skeleton className="h-80 rounded-surface" />
        <div className="flex flex-col gap-5">
          <Skeleton className="h-56 rounded-surface" />
          <Skeleton className="h-40 rounded-surface" />
        </div>
        <Skeleton className="h-72 rounded-surface md:col-span-2" />
      </div>
    </PageLoading>
  );
}
