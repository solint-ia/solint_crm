import { PageLoading } from '@/components/layout/page-loading';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';

/**
 * Esqueleto da base de contatos.
 *
 * Virou componente em vez de `loading.tsx` pelo mesmo motivo do
 * `inbox-skeleton`: a fronteira de Suspense de um `loading.tsx` cobre tambem as
 * rotas filhas e faz o Next despachar 200 antes de `/contatos/[id]` poder
 * responder 404.
 */
export function ContactsSkeleton() {
  return (
    <PageLoading label="Carregando a base de contatos">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 min-w-60 flex-1 rounded-control" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-36 rounded-control" />
        ))}
      </div>
      <SkeletonTable rows={8} columns={7} />
    </PageLoading>
  );
}

/** Esqueleto do perfil de um contato. */
export function ContactDetailSkeleton() {
  return (
    <PageLoading label="Carregando o perfil do contato">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-surface border border-line bg-surface p-5">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 rounded-control" />
        </div>
        <div className="lg:col-span-2">
          <Skeleton className="h-80 rounded-surface" />
        </div>
      </div>
    </PageLoading>
  );
}
