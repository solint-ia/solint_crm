import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { AccountWebhooksCard } from '@/features/plataforma/components/account-webhooks-card';
import { AccountInboxWebhooksCard } from '@/features/plataforma/components/account-inbox-webhooks-card';
import { AccountApiTokensCard } from '@/features/plataforma/components/account-api-tokens-card';

export const metadata: Metadata = { title: 'Integrações da conta' };

export const dynamic = 'force-dynamic';

export default async function ContaDaPlataformaPage({
  params,
}: {
  readonly params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  // Cada consulta continua escopada por `accountId` — o que a área de
  // plataforma muda é quem pode escolher o `accountId`, não que ele deixe de
  // existir. Ver REGRAS-GLOBAIS.md §4.4.
  const [conta, webhooks, inboxes, tokens] = await Promise.all([
    prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, plan: true },
    }),
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
      },
    }),
    prisma.inbox.findMany({
      where: { accountId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, channel: true, identifier: true, webhookUrl: true },
    }),
    prisma.apiToken.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true },
    }),
  ]);

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
        <div>
          <h1 className="font-display text-xl font-bold text-ink">{conta.name}</h1>
          <p className="font-mono text-[11px] text-dim">{conta.id}</p>
        </div>
      </div>

      <AccountWebhooksCard
        accountId={conta.id}
        webhooks={webhooks.map((row) => ({
          id: row.id,
          name: row.name,
          url: row.url,
          events: readJson<readonly string[]>(row.events, []),
          enabled: row.isActive,
          failureCount: row.failureCount,
        }))}
      />

      <AccountInboxWebhooksCard
        accountId={conta.id}
        inboxes={inboxes.map((row) => ({
          id: row.id,
          name: row.name,
          channel: row.channel,
          identifier: row.identifier,
          webhookUrl: row.webhookUrl ?? '',
        }))}
      />

      <AccountApiTokensCard
        accountId={conta.id}
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
