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
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-5">
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
            {currentPipeline.inboxName ? (
              <span className="font-medium text-ink">
                Caixa: <strong className="text-brand">{currentPipeline.inboxName}</strong> ·{' '}
              </span>
            ) : null}
            Arraste as oportunidades entre as etapas para atualizar o funil
          </p>
        </div>

        {/* Seletor de Caixa de Entrada / Funil Segmentado */}
        {pipelines.length > 1 && (
          <div className="flex items-center gap-1 self-start rounded-xl border border-line bg-surface-2/80 p-1 shadow-2xs sm:self-auto overflow-x-auto max-w-full">
            {pipelines.map((pl) => {
              const active = pl.id === currentPipeline.id;
              const isWhatsApp = Boolean(pl.inboxId);
              return (
                <Link
                  key={pl.id}
                  href={`/kanban?funil=${pl.id}` as Route}
                  className={cn(
                    'group relative inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all duration-150',
                    active
                      ? 'bg-surface text-ink shadow-xs border border-line/70 font-bold'
                      : 'text-muted hover:bg-surface/50 hover:text-ink border border-transparent',
                  )}
                >
                  {/* Ícone de Canal com indicação de cor */}
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-md transition-colors',
                      isWhatsApp
                        ? active
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'text-emerald-600/70 group-hover:text-emerald-600'
                        : active
                          ? 'bg-brand/15 text-brand'
                          : 'text-muted group-hover:text-brand',
                    )}
                  >
                    {isWhatsApp ? (
                      <MessageCircle className="size-3.5" />
                    ) : (
                      <Layers className="size-3.5" />
                    )}
                  </span>
                  <span>{pl.inboxName ?? pl.name}</span>
                  {active && (
                    <span className="size-1.5 rounded-full bg-brand shrink-0" />
                  )}
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
