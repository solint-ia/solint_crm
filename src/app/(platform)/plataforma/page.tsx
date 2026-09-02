import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { Building2, ChevronRight, PauseCircle, Plus, Search, Trash2, Users } from 'lucide-react';
import { readSuperAdmin } from '@/infrastructure/auth/session';
import { prisma } from '@/infrastructure/db/prisma';
import { EnterAccountButton } from '@/features/plataforma/components/enter-account-button';
import { AccountStatusBadge } from '@/features/plataforma/components/account-status-badge';

export const metadata: Metadata = { title: 'Console' };

/** Sempre do banco: a lista muda a cada conta criada, e é curta. */
export const dynamic = 'force-dynamic';

type Filtro = 'ativas' | 'suspensas' | 'excluidas' | 'todas';

const FILTROS: readonly { readonly id: Filtro; readonly label: string }[] = [
  { id: 'ativas', label: 'Ativas' },
  { id: 'suspensas', label: 'Suspensas' },
  { id: 'excluidas', label: 'Excluídas' },
  { id: 'todas', label: 'Todas' },
];

const statusDoFiltro = (filtro: Filtro) =>
  filtro === 'ativas'
    ? 'ativa'
    : filtro === 'suspensas'
      ? 'suspensa'
      : filtro === 'excluidas'
        ? 'excluida'
        : undefined;

/**
 * A tela inicial de quem administra a plataforma.
 *
 * Ela responde três perguntas, nesta ordem: **em que estado está o parque**
 * (quantas contas, quantas fora do ar), **onde eu preciso agir** (as suspensas
 * primeiro, porque são as que alguém está esperando voltar), e **em qual conta
 * eu quero entrar**. É deliberadamente diferente do CRM: quem chega aqui não
 * está atendendo ninguém, está decidindo sobre empresas.
 *
 * O padrão da lista é `ativas`. Contas excluídas ficam atrás de um filtro em
 * vez de sumirem: elas continuam existindo — a exclusão é uma marca — e a única
 * forma de restaurar uma é conseguir vê-la.
 */
export default async function PlataformaPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const busca = typeof query.q === 'string' ? query.q.trim() : '';
  const filtro: Filtro =
    query.estado === 'suspensas' || query.estado === 'excluidas' || query.estado === 'todas'
      ? query.estado
      : 'ativas';

  const admin = await readSuperAdmin();
  const status = statusDoFiltro(filtro);

  // tenant-ok: esta é a área de plataforma — enxergar todas as contas é
  // exatamente o que ela existe para fazer, e o layout já garantiu que só o
  // superadministrador chegou até aqui.
  const [contas, porEstado] = await Promise.all([
    prisma.account.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(busca
          ? {
              OR: [
                { name: { contains: busca, mode: 'insensitive' as const } },
                { id: { contains: busca, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        plan: true,
        status: true,
        suspendedReason: true,
        createdAt: true,
        _count: { select: { inboxes: true, webhooks: true, apiTokens: true, memberships: true } },
      },
    }),
    // Uma consulta agrupada em vez de três contagens: o painel do topo precisa
    // dos três números juntos e eles vêm da mesma tabela.
    prisma.account.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const total = porEstado.reduce((soma, linha) => soma + linha._count._all, 0);
  const contar = (valor: string) =>
    porEstado.find((linha) => linha.status === valor)?._count._all ?? 0;

  const resumo = [
    { label: 'Contas ativas', valor: contar('ativa'), icone: Building2, tom: 'text-brand' },
    { label: 'Suspensas', valor: contar('suspensa'), icone: PauseCircle, tom: 'text-amber-600' },
    { label: 'Excluídas', valor: contar('excluida'), icone: Trash2, tom: 'text-rose-600' },
    { label: 'Total cadastrado', valor: total, icone: Users, tom: 'text-muted' },
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">
            {admin ? `Olá, ${admin.name.split(' ')[0]}` : 'Console'}
          </h1>
          <p className="text-xs text-muted">
            Abra a ficha para administrar uma conta, ou entre nela para operar o CRM do cliente.
          </p>
        </div>
        <Link
          href={'/plataforma/nova' as Route}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-brand-deep"
        >
          <Plus className="size-3.5" />
          Nova conta
        </Link>
      </div>

      {/* O painel de números vem antes da lista porque a primeira pergunta de
          quem abre esta tela é sobre o parque, não sobre uma conta específica. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {resumo.map((item) => (
          <div key={item.label} className="rounded-2xl border border-line bg-surface p-4 shadow-2xs">
            <item.icone className={`size-4 ${item.tom}`} />
            <p className="mt-2 font-display text-xl font-bold tabular-nums text-ink">{item.valor}</p>
            <p className="text-[11px] text-muted">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Busca e filtro por GET: o estado mora na URL, então o link é
          compartilhável e o botão voltar do navegador funciona sem JavaScript. */}
      <form method="get" className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-dim" />
          <input
            type="search"
            name="q"
            defaultValue={busca}
            placeholder="Buscar por nome ou identificador da conta"
            aria-label="Buscar conta"
            className="h-10 w-full rounded-xl border border-line bg-surface pr-3 pl-10 text-xs text-ink placeholder:text-dim shadow-2xs outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTROS.map((item) => (
            <button
              key={item.id}
              type="submit"
              name="estado"
              value={item.id}
              className={
                filtro === item.id
                  ? 'rounded-lg bg-brand px-3 py-1.5 text-[11px] font-semibold text-white'
                  : 'rounded-lg bg-surface px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:text-ink'
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </form>

      {contas.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-xs text-muted">
          {busca
            ? `Nenhuma conta encontrada para “${busca}”.`
            : 'Nenhuma conta neste estado.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {contas.map((conta) => (
            <li
              key={conta.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-2xs"
            >
              {/* Dois destinos de peso diferente, e por isso separados: a ficha
                  administra, entrar na conta passa a agir nos dados do cliente. */}
              <Link
                href={`/plataforma/${conta.id}` as Route}
                className="group flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-display text-sm font-bold text-ink group-hover:text-brand">
                      {conta.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted uppercase">
                      {conta.plan}
                    </span>
                    <AccountStatusBadge status={conta.status} />
                  </div>
                  <p className="truncate font-mono text-[11px] text-dim">{conta.id}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    {conta._count.memberships} pessoa(s) · {conta._count.inboxes} caixa(s) ·{' '}
                    {conta._count.webhooks} webhook(s) · {conta._count.apiTokens} token(s)
                  </p>
                  {conta.status !== 'ativa' && conta.suspendedReason ? (
                    <p className="mt-1 truncate text-[11px] text-amber-600">
                      {conta.suspendedReason}
                    </p>
                  ) : null}
                </div>
                <ChevronRight className="size-4 shrink-0 text-dim" />
              </Link>
              {/* Entrar só faz sentido numa conta no ar: numa suspensa,
                  `readSession()` recusaria a sessão e o botão levaria a uma
                  tela em branco. */}
              {conta.status === 'ativa' ? (
                <EnterAccountButton accountId={conta.id} accountName={conta.name} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
