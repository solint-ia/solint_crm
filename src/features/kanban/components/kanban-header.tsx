'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { Layers, MessageCircle } from 'lucide-react';

import type { AppNotification } from '@/core/domain/notification';
import type { Account } from '@/core/domain/user';
import type { Pipeline } from '@/core/domain/pipeline';
import type { NavItem } from '@/config/navigation';
import { GlobalSearch } from '@/features/busca/components/global-search';
import { NotificationsMenu } from '@/components/layout/notifications-menu';
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher';
import { cn } from '@/lib/cn';

interface KanbanHeaderProps {
  readonly currentPipeline: Pipeline;
  readonly pipelines: readonly Pipeline[];
  readonly account: Account;
  readonly accounts: readonly Account[];
  readonly notifications: readonly AppNotification[];
  readonly navItems: readonly NavItem[];
}

export function KanbanHeader({
  currentPipeline,
  pipelines,
  account,
  accounts,
  notifications,
  navItems,
}: KanbanHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-line bg-surface px-4 py-3 shadow-2xs md:flex-row md:items-center md:justify-between md:gap-4 md:px-6 md:py-3.5">
      {/* Lado Esquerdo: Título, Subtítulo e Seletor de Funil */}
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-title font-bold tracking-tight text-ink">
              Funil de oportunidades
            </h1>
            <span className="hidden rounded-full bg-brand/10 px-2 py-0.5 text-micro font-semibold text-brand md:inline-flex">
              CRM Comercial
            </span>
          </div>
          <p className="text-meta text-muted">
            {currentPipeline.inboxName ? `${currentPipeline.inboxName} · ` : ''}
            Arraste as oportunidades entre as etapas para atualizar o funil
          </p>
        </div>

        {/* Seletor de Funil */}
        {pipelines.length > 1 && (
          <div className="flex items-center gap-1 self-start rounded-control border border-line bg-surface-2 p-0.5 sm:self-auto">
            {pipelines.map((pl) => {
              const active = pl.id === currentPipeline.id;
              return (
                <Link
                  key={pl.id}
                  href={`/kanban?funil=${pl.id}` as Route}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-meta font-semibold transition-all duration-150',
                    active
                      ? 'bg-surface text-brand shadow-xs'
                      : 'text-muted hover:bg-surface/50 hover:text-ink',
                  )}
                >
                  {/* O ícone diz de que espécie é o funil: um número do
                      WhatsApp, ou um funil avulso que atravessa canais. */}
                  {pl.inboxId ? (
                    <MessageCircle className="size-3" />
                  ) : (
                    <Layers className="size-3" />
                  )}
                  <span>{pl.inboxName ?? pl.name}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Lado Direito: Busca Global (Ctrl+K), Notificações e Seletor de Workspace */}
      <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3">
        <GlobalSearch navItems={navItems} />
        <NotificationsMenu notifications={notifications} />
        <WorkspaceSwitcher current={account} accounts={accounts} />
      </div>
    </header>
  );
}
