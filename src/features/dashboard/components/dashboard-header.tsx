'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, RefreshCw, Sparkles } from 'lucide-react';
import type { PeriodKey } from '@/core/domain/analytics';
import { PeriodSelector } from './period-selector';
import { cn } from '@/lib/cn';

interface DashboardHeaderProps {
  readonly userName: string;
  readonly period: PeriodKey;
}

export function DashboardHeader({ userName, period }: DashboardHeaderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const firstName = userName.split(' ')[0] || 'Usuário';

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  return (
    <div className="flex flex-col gap-4 border-b border-line bg-surface px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Visão geral</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-brand dark:bg-blue-950/40 dark:text-blue-400">
            <Sparkles className="size-3" /> Tempo real
          </span>
        </div>
        <p className="text-sm text-muted">
          {getGreeting()}, <strong className="font-semibold text-ink">{firstName}</strong>. Acompanhe o desempenho do atendimento e vendas.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <PeriodSelector basePath="/dashboard" current={period} />

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          title="Atualizar dados"
          className={cn(
            'inline-flex items-center justify-center rounded-xl border border-line bg-surface p-2 text-muted shadow-2xs transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50',
          )}
        >
          <RefreshCw className={cn('size-4', isPending && 'animate-spin text-brand')} />
        </button>

        <Link
          href="/relatorios"
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-brand/90 active:scale-98"
        >
          <BarChart3 className="size-3.5" />
          Relatórios
        </Link>
      </div>
    </div>
  );
}
