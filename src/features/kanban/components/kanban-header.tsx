'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { CircleDollarSign, Layers, MessageCircle, Plus, Trash2 } from 'lucide-react';

import type { AppNotification } from '@/core/domain/notification';
import type { Account } from '@/core/domain/user';
import type { Pipeline } from '@/core/domain/pipeline';
import type { NavItem } from '@/config/navigation';
import { GlobalSearch } from '@/features/busca/components/global-search';
import { NotificationsMenu } from '@/components/layout/notifications-menu';
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';
import {
  createPipelineAction,
  deletePipelineAction,
  setPipelineShowAmountsAction,
} from '@/app/(workspace)/kanban/actions';

interface KanbanHeaderProps {
  readonly currentPipeline: Pipeline;
  readonly pipelines: readonly Pipeline[];
  readonly account: Account;
  readonly accounts: readonly Account[];
  readonly notifications: readonly AppNotification[];
  readonly navItems: readonly NavItem[];
  readonly canManage: boolean;
  readonly currentDealCount: number;
}

export function KanbanHeader({
  currentPipeline,
  pipelines,
  account,
  accounts,
  notifications,
  navItems,
  canManage,
  currentDealCount,
}: KanbanHeaderProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [togglingAmounts, setTogglingAmounts] = useState(false);
  const defaultPipeline = pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0];

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setSaving(true);
    try {
      const result = await createPipelineAction({ name });
      if (!result.ok || !result.pipelineId) {
        setError(result.error ?? 'Não foi possível criar o funil.');
        return;
      }
      setCreateOpen(false);
      setName('');
      router.push(`/kanban?funil=${encodeURIComponent(result.pipelineId)}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAmounts = async () => {
    setTogglingAmounts(true);
    try {
      const result = await setPipelineShowAmountsAction({
        pipelineId: currentPipeline.id,
        showAmounts: !currentPipeline.showAmounts,
      });
      if (result.ok) router.refresh();
    } finally {
      setTogglingAmounts(false);
    }
  };

  const handleDelete = async () => {
    setError(undefined);
    const result = await deletePipelineAction({ pipelineId: currentPipeline.id });
    if (!result.ok) {
      setError(result.error ?? 'Não foi possível excluir o funil.');
      return;
    }
    setDeleteOpen(false);
    router.push(
      defaultPipeline ? `/kanban?funil=${encodeURIComponent(defaultPipeline.id)}` : '/kanban',
    );
    router.refresh();
  };

  return (
    <>
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
          {(pipelines.length > 1 || canManage) && (
            <div className="flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-xl border border-line bg-surface-2/80 p-1 shadow-2xs sm:self-auto">
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
                    {active && <span className="size-1.5 rounded-full bg-brand shrink-0" />}
                  </Link>
                );
              })}
              {canManage ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setCreateOpen(true);
                  }}
                  aria-label="Criar novo funil"
                  title="Criar novo funil"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-brand"
                >
                  <Plus className="size-4" />
                </button>
              ) : null}
              {canManage ? (
                <button
                  type="button"
                  onClick={() => void handleToggleAmounts()}
                  disabled={togglingAmounts}
                  aria-pressed={currentPipeline.showAmounts}
                  aria-label={
                    currentPipeline.showAmounts
                      ? 'Ocultar valores deste funil'
                      : 'Exibir valores deste funil'
                  }
                  title={
                    currentPipeline.showAmounts
                      ? 'Valores visíveis. Clique para ocultar.'
                      : 'Valores ocultos. Clique para exibir.'
                  }
                  className={cn(
                    'relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-surface disabled:opacity-50',
                    currentPipeline.showAmounts
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-dim hover:text-ink',
                  )}
                >
                  <CircleDollarSign className="size-3.5" />
                  {currentPipeline.showAmounts ? null : (
                    <span
                      aria-hidden
                      className="absolute h-px w-4 rotate-45 rounded bg-current"
                    />
                  )}
                </button>
              ) : null}
              {canManage && !currentPipeline.isDefault ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setDeleteOpen(true);
                  }}
                  aria-label={`Excluir funil ${currentPipeline.name}`}
                  title="Excluir funil atual"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-soft hover:text-red-text"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
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

      <Modal
        open={createOpen}
        onClose={() => {
          if (!saving) setCreateOpen(false);
        }}
        title="Novo funil"
        description="Crie um processo comercial separado, com as etapas padrão prontas para editar."
        className="max-w-md"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-line/50 bg-red-soft px-3 py-2 text-meta text-red-text"
            >
              {error}
            </p>
          ) : null}
          <div>
            <label htmlFor="pipeline-name" className="mb-1.5 block text-xs font-semibold text-ink">
              Nome do funil
            </label>
            <input
              id="pipeline-name"
              autoFocus
              required
              minLength={2}
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Renovações"
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || name.trim().length < 2}>
              {saving ? 'Criando…' : 'Criar funil'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={deleteOpen}
        title="Excluir funil"
        description={
          <span>
            O funil <strong className="text-ink">{currentPipeline.name}</strong> será excluído
            {currentDealCount > 0 ? (
              <>
                {' '}
                junto com {currentDealCount} oportunidade{currentDealCount === 1 ? '' : 's'}.
              </>
            ) : (
              <>. Ele não possui oportunidades.</>
            )}
            {error ? <span className="mt-2 block text-red-text">{error}</span> : null}
          </span>
        }
        confirmLabel="Excluir funil"
        variant="danger"
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
