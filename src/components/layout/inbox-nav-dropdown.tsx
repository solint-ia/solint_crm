'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ChevronRight,
  Globe,
  Inbox,
  Mail,
  MailOpen,
  MessageSquare,
  MessagesSquare,
  Settings,
  Sparkles,
  UserRound,
  UserRoundX,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export interface AccessibleInbox {
  readonly id: string;
  readonly name: string;
  readonly channel: string;
  readonly identifier?: string;
  readonly status: string;
  readonly teamName?: string;
  readonly unreadCount: number;
}

export interface ConversationCounts {
  readonly todas: number;
  readonly minhas: number;
  readonly nao_atribuidas: number;
  readonly naoLidas: number;
}

interface InboxNavDropdownProps {
  readonly accessibleInboxes: readonly AccessibleInbox[];
  readonly totalUnreadCount: number;
  readonly conversationCounts?: ConversationCounts;
  readonly canManageInboxes?: boolean;
  readonly roleName?: string;
  readonly active?: boolean;
}

export function InboxNavDropdown({
  accessibleInboxes,
  totalUnreadCount,
  conversationCounts,
  canManageInboxes = false,
  roleName,
  active = false,
}: InboxNavDropdownProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentCaixa = searchParams.get('caixa');
  const currentScope = searchParams.get('scope');
  const currentUnread = searchParams.get('unread') === 'true';

  // Fecha no Escape e fecha ao navegar
  useEffect(() => {
    setIsOpen(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const channelIcon = (channel: string) => {
    switch (channel) {
      case 'whatsapp':
        return (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <MessageSquare className="size-3.5" />
          </span>
        );
      case 'instagram':
        return (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-pink-500/15 text-pink-600 dark:text-pink-400">
            <Sparkles className="size-3.5" />
          </span>
        );
      case 'email':
        return (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Mail className="size-3.5" />
          </span>
        );
      default:
        return (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
            <Globe className="size-3.5" />
          </span>
        );
    }
  };

  const getScopeHref = (scope?: string, unread?: boolean): Route => {
    const params = new URLSearchParams();
    if (currentCaixa) params.set('caixa', currentCaixa);
    if (scope) params.set('scope', scope);
    if (unread) params.set('unread', 'true');
    const query = params.toString();
    return (`/conversas${query ? `?${query}` : ''}`) as Route;
  };

  const isScopeActive = (scope?: string, unread?: boolean) => {
    if (pathname !== '/conversas') return false;
    if (unread) return currentUnread;
    if (!currentUnread && !currentScope && !scope) return true;
    return currentScope === scope && !currentUnread;
  };

  return (
    <div className="relative">
      {/* Botão de disparo na Barra Lateral */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title={`Caixas de entrada (${accessibleInboxes.length} disponíveis)`}
        aria-label="Caixas de entrada"
        className={cn(
          'group relative flex size-10 items-center justify-center rounded-xl transition-all duration-150',
          active || isOpen
            ? 'bg-brand/12 font-semibold text-brand border border-brand/25 shadow-xs'
            : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
        )}
      >
        <Inbox className="size-[19px] transition-transform group-hover:scale-110" />

        {/* Badge de Não Lidas Total */}
        {totalUnreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-4.5 h-4.5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white shadow-sm shadow-blue-600/40">
            {totalUnreadCount}
          </span>
        )}

        {/* Indicador sutil de dropdown disponível */}
        <span
          className={cn(
            'absolute bottom-1 right-1 size-1 rounded-full transition-all',
            isOpen ? 'bg-brand scale-125' : 'bg-muted/40 group-hover:bg-brand',
          )}
        />
      </button>

      {/* Flyout Subcomponente Flutuante ao lado da Navbar */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <div
            ref={menuRef}
            role="menu"
            aria-label="Caixas de entrada e conversas"
            className="fixed left-16 top-10 z-50 ml-2.5 w-84 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-2xl border border-line bg-surface/95 backdrop-blur-xl p-2.5 shadow-2xl animate-in fade-in slide-in-from-left-2 duration-150"
          >
            {/* Cabeçalho do Menu */}
            <div className="flex items-center justify-between border-b border-line pb-2.5 px-2 pt-1">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-brand">
                  <Inbox className="size-4" />
                </span>
                <div>
                  <h3 className="font-display text-xs font-bold text-ink tracking-tight">
                    Caixas de entrada
                  </h3>
                  <p className="text-[10px] text-muted">
                    {roleName ? `Perfil: ${roleName}` : 'Central de Atendimento'}
                  </p>
                </div>
              </div>

              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-dim border border-line-soft">
                {accessibleInboxes.length} {accessibleInboxes.length === 1 ? 'canal' : 'canais'}
              </span>
            </div>

            {/* SEÇÃO 1: CONVERSAS & FILTROS DE FILA */}
            {conversationCounts && (
              <div className="py-2">
                <div className="px-2 pb-1.5 pt-0.5">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-dim">
                    <MessagesSquare className="size-3 text-muted" />
                    <span>Conversas</span>
                  </span>
                </div>

                <div className="space-y-0.5">
                  <Link
                    href={getScopeHref(undefined, false)}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      'flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-all',
                      isScopeActive(undefined, false)
                        ? 'bg-brand/10 text-brand font-semibold border border-brand/20'
                        : 'text-ink hover:bg-surface-2',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <MessagesSquare className="size-3.5 text-muted" />
                      <span>Todas as conversas</span>
                    </div>
                    {conversationCounts.todas > 0 && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                          isScopeActive(undefined, false)
                            ? 'bg-brand text-white'
                            : 'bg-surface-2 text-muted border border-line-soft',
                        )}
                      >
                        {conversationCounts.todas}
                      </span>
                    )}
                  </Link>

                  <Link
                    href={getScopeHref('minhas')}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      'flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-all',
                      isScopeActive('minhas')
                        ? 'bg-brand/10 text-brand font-semibold border border-brand/20'
                        : 'text-ink hover:bg-surface-2',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <UserRound className="size-3.5 text-muted" />
                      <span>Atribuídas a mim</span>
                    </div>
                    {conversationCounts.minhas > 0 && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                          isScopeActive('minhas')
                            ? 'bg-brand text-white'
                            : 'bg-surface-2 text-muted border border-line-soft',
                        )}
                      >
                        {conversationCounts.minhas}
                      </span>
                    )}
                  </Link>

                  <Link
                    href={getScopeHref('nao_atribuidas')}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      'flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-all',
                      isScopeActive('nao_atribuidas')
                        ? 'bg-brand/10 text-brand font-semibold border border-brand/20'
                        : 'text-ink hover:bg-surface-2',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <UserRoundX className="size-3.5 text-muted" />
                      <span>Não atendidas</span>
                    </div>
                    {conversationCounts.nao_atribuidas > 0 && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                          isScopeActive('nao_atribuidas')
                            ? 'bg-brand text-white'
                            : 'bg-surface-2 text-muted border border-line-soft',
                        )}
                      >
                        {conversationCounts.nao_atribuidas}
                      </span>
                    )}
                  </Link>

                  <Link
                    href={getScopeHref(undefined, true)}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      'flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-all',
                      isScopeActive(undefined, true)
                        ? 'bg-brand/10 text-brand font-semibold border border-brand/20'
                        : 'text-ink hover:bg-surface-2',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <MailOpen className="size-3.5 text-muted" />
                      <span>Não lidas</span>
                    </div>
                    {conversationCounts.naoLidas > 0 && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                          isScopeActive(undefined, true)
                            ? 'bg-brand text-white'
                            : 'bg-blue-600 text-white',
                        )}
                      >
                        {conversationCounts.naoLidas}
                      </span>
                    )}
                  </Link>
                </div>
              </div>
            )}

            {/* SEÇÃO 2: CANAIS DISPONÍVEIS */}
            <div className="border-t border-line-soft pt-2">
              <div className="px-2 pb-1.5 pt-0.5">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-dim">
                  <Inbox className="size-3 text-muted" />
                  <span>Canais & Caixas de Entrada</span>
                </span>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5">
                {accessibleInboxes.length > 0 ? (
                  accessibleInboxes.map((inbox) => {
                    const isSelected = currentCaixa === inbox.id;
                    const isOnline =
                      inbox.status === 'conectado' ||
                      inbox.status === 'ativo' ||
                      inbox.status === 'online';

                    const href = (`/conversas?caixa=${inbox.id}${currentScope ? `&scope=${currentScope}` : ''}${currentUnread ? '&unread=true' : ''}`) as Route;

                    return (
                      <Link
                        key={inbox.id}
                        href={href}
                        onClick={() => setIsOpen(false)}
                        className={cn(
                          'flex items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-xs transition-all',
                          isSelected
                            ? 'bg-brand/10 text-brand font-semibold border border-brand/20'
                            : 'text-ink hover:bg-surface-2',
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {channelIcon(inbox.channel)}
                          <div className="truncate min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-ink truncate block">
                                {inbox.name}
                              </span>
                              <span
                                className={cn(
                                  'size-1.5 shrink-0 rounded-full',
                                  isOnline
                                    ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
                                    : 'bg-amber-500',
                                )}
                                title={isOnline ? 'Conectado' : 'Aguardando conexão'}
                              />
                            </div>
                            <span className="block text-[10px] text-muted truncate">
                              {inbox.teamName
                                ? `Equipe: ${inbox.teamName}`
                                : isOnline
                                  ? inbox.identifier || 'Canal conectado'
                                  : 'Aguardando conexão'}
                            </span>
                          </div>
                        </div>

                        {inbox.unreadCount > 0 && (
                          <span className="flex min-w-4.5 h-4.5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white shrink-0 shadow-xs">
                            {inbox.unreadCount}
                          </span>
                        )}
                      </Link>
                    );
                  })
                ) : (
                  <div className="p-3 text-center text-xs text-muted">
                    Nenhum canal disponível para você.
                  </div>
                )}
              </div>
            </div>

            {/* Rodapé de Gestão de Caixas */}
            {canManageInboxes && (
              <div className="mt-2 border-t border-line pt-2">
                <Link
                  href="/configuracoes?secao=caixas"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-ink transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Settings className="size-3 text-dim" />
                    <span>Gerenciar canais</span>
                  </div>
                  <ChevronRight className="size-3 text-dim" />
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
