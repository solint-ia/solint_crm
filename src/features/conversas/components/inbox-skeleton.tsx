import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';

/**
 * Esqueleto das 3 colunas de /conversas.
 *
 * Deixou de ser um `loading.tsx` de propósito: um `loading.tsx` em qualquer
 * segmento ancestral cria uma fronteira de Suspense, e o Next despacha o
 * cabecalho HTTP 200 antes de a pagina rodar — o `notFound()` do
 * `/conversas/[id]` renderizava a tela certa com o status errado. Aqui o
 * esqueleto vira fallback de um `<Suspense>` DENTRO da pagina, depois da
 * verificacao de existencia. Status correto e esqueleto preservado.
 */
export function InboxSkeleton() {
  return (
    <LoadingRegion label="Carregando a caixa de entrada" className="flex h-full min-h-0 flex-1">
      <section className="flex w-full flex-col border-r border-line bg-surface lg:w-[340px] lg:shrink-0">
        <div className="shrink-0 border-b border-line px-3 py-3">
          <Skeleton className="mb-2.5 h-9 rounded-control" />
          <Skeleton className="h-8 rounded-control" />
        </div>
        <div className="flex flex-col">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex gap-3 border-b border-line-soft px-3.5 py-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-4 w-24 rounded-control" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="hidden min-w-0 flex-1 flex-col bg-chat lg:flex">
        <header className="flex h-15 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-2.5 w-56" />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-3 px-5 py-4">
          <Skeleton className="h-16 w-3/5 rounded-bubble" />
          <Skeleton className="h-12 w-2/5 self-end rounded-bubble" />
          <Skeleton className="h-20 w-1/2 rounded-bubble" />
          <Skeleton className="h-14 w-1/3 self-end rounded-bubble" />
        </div>
        <div className="shrink-0 border-t border-line bg-surface px-4 py-3">
          <Skeleton className="h-16 rounded-control" />
        </div>
      </div>

      <aside className="hidden w-[320px] shrink-0 flex-col gap-4 border-l border-line bg-surface p-4 xl:flex">
        <Skeleton className="size-14 self-center rounded-full" />
        <Skeleton className="h-3.5 w-2/3 self-center" />
        <Skeleton className="h-24 rounded-control" />
        <Skeleton className="h-32 rounded-control" />
      </aside>
    </LoadingRegion>
  );
}
