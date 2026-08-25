import { PageLoading } from '@/components/layout/page-loading';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';

/**
 * Esqueleto da base de contatos.
 *
 * Virou componente em vez de `loading.tsx` pelo mesmo motivo do
 * `inbox-skeleton`: a fronteira de Suspense de um `loading.tsx` cobre também as
 * rotas filhas e faz o Next despachar 200 antes de `/contatos/[id]` poder
 * responder 404.
 */
export function ContactsSkeleton() {
  return (
    <PageLoading label="Carregando a base de contatos">
      <div className="flex flex-col gap-4">
        {/* Barra de Ferramentas Skeleton */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-10 w-full max-w-xl rounded-xl" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-10 w-32 rounded-control" />
            <Skeleton className="h-10 w-28 rounded-control" />
            <Skeleton className="h-10 w-24 rounded-control" />
            <Skeleton className="h-10 w-32 rounded-control" />
          </div>
        </div>

        {/* Tabela Skeleton */}
        <div className="overflow-hidden rounded-2xl border border-line bg-surface p-2 shadow-xs">
          <SkeletonTable rows={8} columns={7} />
        </div>
      </div>
    </PageLoading>
  );
}

/** Esqueleto do perfil de um contato. */
export function ContactDetailSkeleton() {
  return (
    <PageLoading label="Carregando o perfil do contato">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <Skeleton className="size-14 rounded-full mx-auto" />
          <Skeleton className="h-5 w-40 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
          <Skeleton className="h-24 rounded-xl mt-4" />
        </div>
        <div className="lg:col-span-2">
          <Skeleton className="h-96 rounded-2xl border border-line bg-surface shadow-xs" />
        </div>
      </div>
    </PageLoading>
  );
}
