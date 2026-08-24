import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PhoneNumber } from '@/core/domain/contact';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardHeader } from '@/components/ui/card';
import { LabelChips } from '@/components/domain/label-chip';
import { Topbar } from '@/components/layout/topbar';
import { PageShell } from '@/components/layout/page-shell';
import { ContactTimeline } from '@/features/contatos/components/contact-timeline';
import { ContactDetailSkeleton } from '@/features/contatos/components/contacts-skeleton';
import { ContactDetailActions } from '@/features/contatos/components/contact-detail-actions';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';

export const metadata: Metadata = { title: 'Perfil do contato' };

/**
 * A busca pelo contato acontece antes do `<Suspense>`: e' uma consulta barata,
 * nada foi despachado ainda, e por isso `notFound()` consegue devolver 404 de
 * verdade. O resto da tela suspende com esqueleto.
 */
export default async function ContatoDetalhePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'contatos:ler')) return <AccessDenied permission="contatos:ler" />;
  const contact = await container.contacts.findById(session.account.id, id);
  if (!contact) notFound();

  return (
    <Suspense fallback={<ContactDetailSkeleton />}>
      <ContatoDetalhe contactId={contact.id} />
    </Suspense>
  );
}

async function ContatoDetalhe({ contactId }: { readonly contactId: string }) {
  const session = await container.session.getCurrentSession();
  const contact = await container.contacts.findById(session.account.id, contactId);
  if (!contact) notFound();

  const notifications = await container.notifications.list(session.account.id, session.user.id);

  return (
    <>
      <Topbar
        title={contact.name}
        subtitle={contact.company ?? 'Sem empresa vinculada'}
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
        actions={
          <div className="flex items-center gap-2">
            <ContactDetailActions contact={contact} />
            <Link
              href="/contatos"
              className="flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-body font-semibold text-ink transition-colors hover:bg-surface-2"
            >
              <ArrowLeft className="size-3.5" />
              Voltar
            </Link>
          </div>
        }
      />

      <PageShell>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <div className="flex flex-col items-center gap-2 text-center">
              <Avatar name={contact.name} tone={contact.avatarTone} size="lg" />
              <p className="font-display text-title font-semibold text-ink">{contact.name}</p>
              <p className="font-mono text-body text-muted">
                {PhoneNumber.format(contact.phone)}
              </p>
              {contact.email ? <p className="text-body text-muted">{contact.email}</p> : null}
              <p className="text-meta text-dim">
                {contact.location} · {contact.timezone}
              </p>
              <LabelChips labels={contact.labels} />
            </div>

            <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
              {contact.customFields.map((field) => (
                <div key={field.label} className="flex items-center justify-between gap-2">
                  <dt className="text-meta text-muted">{field.label}</dt>
                  <dd className="font-mono text-meta text-ink">{field.value}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-meta text-muted">Responsável</dt>
                <dd className="text-meta text-ink">{contact.ownerName ?? '—'}</dd>
              </div>
            </dl>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title="Linha do tempo"
              description="Conversas, notas e movimentações no funil"
            />
            <ContactTimeline events={contact.timeline ?? []} />
          </Card>
        </div>
      </PageShell>
    </>
  );
}
