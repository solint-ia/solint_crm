import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import {
  AccountWebhooksCard,
  WEBHOOK_SEM_CAIXA,
} from '@/features/plataforma/components/account-webhooks-card';
import { AccountApiTokensCard } from '@/features/plataforma/components/account-api-tokens-card';
import { AccountStatusBadge } from '@/features/plataforma/components/account-status-badge';
import { AccountOverview } from '@/features/plataforma/components/account-overview';
import { AccountMembersCard } from '@/features/plataforma/components/account-members-card';
import { AccountDangerZone } from '@/features/plataforma/components/account-danger-zone';
import { EnterAccountButton } from '@/features/plataforma/components/enter-account-button';

export const metadata: Metadata = { title: 'Ficha da conta' };

export const dynamic = 'force-dynamic';

type Aba = 'visao' | 'membros' | 'integracoes' | 'perigo';

const ABAS: readonly { readonly id: Aba; readonly label: string }[] = [
  { id: 'visao', label: 'Visão geral' },
  { id: 'membros', label: 'Membros' },
  { id: 'integracoes', label: 'Integrações' },
  { id: 'perigo', label: 'Zona de perigo' },
];

/**
 * A ficha de uma conta, em abas.
 *
 * Era uma página só, com os três cartões de integração empilhados. Com membros
 * e zona de perigo entrando, empilhar mais colocaria o botão de excluir a conta
 * a uma rolagem de distância do de girar um token — e a proximidade entre uma
 * ação corriqueira e uma irreversível é justamente o que produz o clique
 * errado. A zona de perigo fica atrás da própria aba, que é a menor barreira
 * que ainda é uma barreira.
 *
 * A aba mora na URL (`?aba=`) e não em estado de cliente: assim o link para "a
 * zona de perigo da conta X" existe, e o botão voltar do navegador funciona.
 */
export default async function ContaDaPlataformaPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ accountId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId } = await params;
  const query = await searchParams;
  const aba: Aba = ABAS.some((item) => item.id === query.aba) ? (query.aba as Aba) : 'visao';

  // Cada consulta continua escopada por `accountId` — o que a área de
  // plataforma muda é quem pode escolher o `accountId`, não que ele deixe de
  // existir. Ver REGRAS-GLOBAIS.md §4.4.
  const conta = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      plan: true,
      document: true,
      status: true,
      suspendedAt: true,
      suspendedReason: true,
      createdAt: true,
    },
  });
  if (!conta) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/plataforma"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Todas as contas
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold text-ink">{conta.name}</h1>
              <AccountStatusBadge status={conta.status} />
            </div>
            <p className="font-mono text-[11px] text-dim">{conta.id}</p>
          </div>
          {conta.status === 'ativa' ? (
            <EnterAccountButton accountId={conta.id} accountName={conta.name} />
          ) : null}
        </div>
      </div>

      {conta.status !== 'ativa' && conta.suspendedReason ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700">
          {conta.suspendedReason}
        </p>
      ) : null}

      <nav className="flex flex-wrap gap-1 border-b border-line pb-2">
        {ABAS.map((item) => (
          <Link
            key={item.id}
            href={`/plataforma/${conta.id}?aba=${item.id}` as Route}
            className={
              aba === item.id
                ? 'rounded-lg bg-brand px-3 py-1.5 text-[11px] font-semibold text-white'
                : `rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors hover:text-ink ${
                    item.id === 'perigo' ? 'text-rose-600/70' : 'text-muted'
                  }`
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {aba === 'visao' ? <VisaoGeral accountId={conta.id} conta={conta} /> : null}
      {aba === 'membros' ? <Membros accountId={conta.id} /> : null}
      {aba === 'integracoes' ? <Integracoes accountId={conta.id} /> : null}
      {aba === 'perigo' ? (
        <AccountDangerZone
          accountId={conta.id}
          accountName={conta.name}
          status={conta.status}
          suspendedAt={conta.suspendedAt ? conta.suspendedAt.toISOString() : undefined}
        />
      ) : null}
    </div>
  );
}

async function VisaoGeral({
  accountId,
  conta,
}: {
  readonly accountId: string;
  readonly conta: {
    readonly plan: string;
    readonly document: string | null;
    readonly createdAt: Date;
  };
}) {
  const [membros, caixas, contatos, conversas, mensagens, ultimaAtividade] = await Promise.all([
    prisma.membership.count({ where: { accountId } }),
    prisma.inbox.count({ where: { accountId } }),
    prisma.contact.count({ where: { accountId, deletedAt: null } }),
    prisma.conversation.count({ where: { accountId } }),
    prisma.message.count({ where: { conversation: { accountId } } }),
    prisma.conversation.findFirst({
      where: { accountId, lastActivityAt: { not: null } },
      orderBy: { lastActivityAt: 'desc' },
      select: { lastActivityAt: true },
    }),
  ]);

  return (
    <AccountOverview
      plan={conta.plan}
      document={conta.document ?? undefined}
      createdAt={conta.createdAt.toISOString()}
      lastActivityAt={ultimaAtividade?.lastActivityAt?.toISOString()}
      numeros={{ membros, caixas, contatos, conversas, mensagens }}
    />
  );
}

async function Membros({ accountId }: { readonly accountId: string }) {
  const [vinculos, papeis] = await Promise.all([
    prisma.membership.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: {
        roleSlug: true,
        availability: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, lastActiveAt: true } },
      },
    }),
    prisma.role.findMany({ where: { accountId }, select: { slug: true, name: true } }),
  ]);

  const nomeDoPapel = new Map(papeis.map((papel) => [papel.slug, papel.name]));

  return (
    <AccountMembersCard
      members={vinculos.map((vinculo) => ({
        id: vinculo.user.id,
        name: vinculo.user.name,
        email: vinculo.user.email,
        roleSlug: vinculo.roleSlug,
        roleName: nomeDoPapel.get(vinculo.roleSlug) ?? vinculo.roleSlug,
        availability: vinculo.availability,
        joinedAt: vinculo.createdAt.toISOString(),
        ...(vinculo.user.lastActiveAt ? { lastActiveAt: vinculo.user.lastActiveAt } : {}),
      }))}
    />
  );
}

async function Integracoes({ accountId }: { readonly accountId: string }) {
  const [webhooks, inboxes, tokens, pendentes] = await Promise.all([
    prisma.webhook.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        url: true,
        events: true,
        isActive: true,
        failureCount: true,
        allInboxes: true,
        inboxes: { select: { inboxId: true } },
      },
    }),
    prisma.inbox.findMany({
      where: { accountId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        channel: true,
        identifier: true,
        status: true,
        webhookUrl: true,
      },
    }),
    prisma.apiToken.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true },
    }),
    // O que ainda está na fila, por webhook e por caixa. Restringir o escopo
    // cancela justamente estas linhas, e a tela precisa dizer quantas são
    // **antes** de o superadministrador confirmar.
    prisma.webhookDelivery.groupBy({
      by: ['webhookId', 'inboxId'],
      where: { accountId, status: 'pending' },
      _count: { _all: true },
    }),
  ]);

  const pendentesPorWebhook = new Map<string, Map<string, number>>();
  for (const linha of pendentes) {
    const porCaixa = pendentesPorWebhook.get(linha.webhookId) ?? new Map<string, number>();
    // A entrega sem caixa (evento que não nasceu de uma conversa) some assim
    // que o webhook deixa de valer para todas: entra no mapa sob uma chave
    // própria para o aviso poder contá-la.
    porCaixa.set(linha.inboxId ?? WEBHOOK_SEM_CAIXA, linha._count._all);
    pendentesPorWebhook.set(linha.webhookId, porCaixa);
  }

  return (
    <div className="flex flex-col gap-4">
      <AccountWebhooksCard
        accountId={accountId}
        webhooks={webhooks.map((row) => ({
          id: row.id,
          name: row.name,
          url: row.url,
          events: readJson<readonly string[]>(row.events, []),
          enabled: row.isActive,
          failureCount: row.failureCount,
          allInboxes: row.allInboxes,
          inboxIds: row.inboxes.map((link) => link.inboxId),
          pendingByInbox: Object.fromEntries(pendentesPorWebhook.get(row.id) ?? []),
        }))}
        inboxes={inboxes.map((row) => ({
          id: row.id,
          name: row.name,
          channel: row.channel,
          identifier: row.identifier,
          status: row.status,
          legacyWebhookUrl: row.webhookUrl ?? '',
        }))}
      />

      <AccountApiTokensCard
        accountId={accountId}
        tokens={tokens.map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.tokenPrefix,
          createdLabel: row.createdAt.toISOString().slice(0, 10),
          lastUsedLabel: row.lastUsedAt ? row.lastUsedAt.toISOString().slice(0, 10) : 'Nunca usado',
        }))}
      />
    </div>
  );
}
