import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InboxData } from '@/features/conversas/components/inbox-data';
import { InboxSkeleton } from '@/features/conversas/components/inbox-skeleton';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';

export const metadata: Metadata = { title: 'Caixa de entrada' };

/**
 * Mesma caixa de entrada de /conversas, com uma conversa ja aberta.
 * Existe para que notificacoes, busca global e cards do funil possam apontar
 * direto para o atendimento em vez de largar o usuario na lista.
 *
 * A ordem aqui é o que garante o 404 correto: a busca pela conversa é uma
 * consulta barata e acontece ANTES do `<Suspense>`. Nada foi despachado ainda,
 * então `notFound()` consegue trocar o status. A parte cara — listar todas as
 * conversas — suspende depois, com esqueleto.
 */
export default async function ConversaPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await container.session.getCurrentSession();
  if (!can(session, 'conversas:ler')) return <AccessDenied permission="conversas:ler" />;

  const conversation = await container.conversations.findById(session.account.id, id, session.inboxAccess);
  if (!conversation) notFound();

  return (
    <Suspense fallback={<InboxSkeleton />}>
      <InboxData selectedId={conversation.id} initialInboxId={conversation.inboxId} />
    </Suspense>
  );
}
