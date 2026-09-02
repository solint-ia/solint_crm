import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight, Search } from 'lucide-react';
import { prisma } from '@/infrastructure/db/prisma';
import { EnterAccountButton } from '@/features/plataforma/components/enter-account-button';

export const metadata: Metadata = { title: 'Contas' };

/** Sempre do banco: a lista muda a cada cadastro novo, e é curta. */
export const dynamic = 'force-dynamic';

export default async function PlataformaPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const busca = typeof query.q === 'string' ? query.q.trim() : '';

  // tenant-ok: esta é a área de plataforma — listar todas as contas é
  // exatamente o que ela existe para fazer, e o layout já garantiu que só o
  // superadministrador chegou até aqui.
  const contas = await prisma.account.findMany({
    where: busca
      ? {
          OR: [
            { name: { contains: busca, mode: 'insensitive' } },
            { id: { contains: busca, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      plan: true,
      createdAt: true,
      _count: { select: { inboxes: true, webhooks: true, apiTokens: true, memberships: true } },
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-bold text-ink">Contas</h1>
        <p className="text-xs text-muted">
          Abra a ficha para administrar integrações, ou entre na conta para operar o CRM dela.
        </p>
      </div>

      {/* Busca por GET: o estado mora na URL, então o link é compartilhável e o
          botão voltar do navegador funciona sem nenhum JavaScript. */}
      <form method="get" className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-dim" />
        <input
          type="search"
          name="q"
          defaultValue={busca}
          placeholder="Buscar por nome ou identificador da conta"
          aria-label="Buscar conta"
          className="h-10 w-full rounded-xl border border-line bg-surface pr-3 pl-10 text-xs text-ink placeholder:text-dim shadow-2xs outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </form>

      {contas.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-xs text-muted">
          {busca ? `Nenhuma conta encontrada para “${busca}”.` : 'Nenhuma conta cadastrada ainda.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {contas.map((conta) => (
            <li
              key={conta.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-2xs"
            >
              {/* Dois destinos de peso diferente, e por isso separados: a ficha
                  só lê, entrar na conta passa a agir nos dados do cliente. */}
              <Link
                href={`/plataforma/${conta.id}` as Route}
                className="group flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-sm font-bold text-ink group-hover:text-brand">
                      {conta.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted uppercase">
                      {conta.plan}
                    </span>
                  </div>
                  <p className="truncate font-mono text-[11px] text-dim">{conta.id}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    {conta._count.memberships} pessoa(s) · {conta._count.inboxes} caixa(s) ·{' '}
                    {conta._count.webhooks} webhook(s) · {conta._count.apiTokens} token(s)
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-dim" />
              </Link>
              <EnterAccountButton accountId={conta.id} accountName={conta.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
