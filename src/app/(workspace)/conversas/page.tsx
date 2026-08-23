import { Suspense } from 'react';
import type { Metadata } from 'next';
import { InboxData } from '@/features/conversas/components/inbox-data';
import { InboxSkeleton } from '@/features/conversas/components/inbox-skeleton';

export const metadata: Metadata = { title: 'Caixa de entrada' };

/**
 * /conversas e a unica tela sem topbar: usa o layout canonico de 4 colunas
 * (rail + lista + chat + contexto), conforme SKILL.md secao 4.
 *
 * O `<Suspense>` mora aqui, e não num `loading.tsx`: a fronteira de Suspense de
 * um `loading.tsx` alcanca tambem as rotas filhas, e faz o Next despachar 200
 * antes de `/conversas/[id]` poder responder 404. Ver `inbox-skeleton.tsx`.
 */
export default function ConversasPage() {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <InboxData />
    </Suspense>
  );
}
