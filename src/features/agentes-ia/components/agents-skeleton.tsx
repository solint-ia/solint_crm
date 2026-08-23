import { PageLoading } from '@/components/layout/page-loading';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';

/**
 * Esqueleto da lista de agentes.
 *
 * Componente, e não `loading.tsx`: a fronteira de Suspense de um `loading.tsx`
 * cobre tambem `/agentes-ia/[id]`, e faria o Next despachar 200 antes de a
 * pagina poder responder 404 para um agente inexistente.
 */
export function AgentsSkeleton() {
  return (
    <PageLoading label="Carregando os agentes de IA">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonCard key={i} className="h-56" />
        ))}
      </div>
    </PageLoading>
  );
}

/** Esqueleto da configuracao de um agente. */
export function AgentDetailSkeleton() {
  return (
    <PageLoading label="Carregando a configuração do agente">
      <Skeleton className="mb-4 h-9 w-[32rem] max-w-full rounded-control" />
      <Skeleton className="h-96 max-w-3xl rounded-surface" />
    </PageLoading>
  );
}
