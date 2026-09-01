'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot,
  ChevronDown,
  GripVertical,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  Menu,
  Settings,
  Users,
  X,
} from 'lucide-react';
import type { NavIcon, NavItem } from '@/config/navigation';
import type { AvailabilityStatus } from '@/core/domain/user';
import { Avatar } from '@/components/ui/avatar';
import { LogoutButton } from '@/features/auth/components/logout-button';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './theme-toggle';
import {
  InboxNavDropdown,
  type AccessibleInbox,
  type ConversationCounts,
} from './inbox-nav-dropdown';

/* ==========================================================================
   Largura da barra lateral — arrastável.
   ========================================================================== */

/** Só ícones. É a largura que a barra sempre teve. */
const RAIL_MIN = 64;
/** Onde os nomes cabem sem quebrar em duas linhas. */
const RAIL_MAX = 248;
/**
 * A partir daqui os rótulos aparecem.
 *
 * Não é o mesmo valor de `RAIL_MIN`: entre 64 e 112 não há espaço para o texto
 * ao lado do ícone, e revelar o rótulo antes disso o cortaria no meio.
 */
const RAIL_LABEL_FROM = 112;
const RAIL_STORAGE_KEY = 'solint:rail-width';

const clampRail = (valor: number): number => Math.min(RAIL_MAX, Math.max(RAIL_MIN, valor));

const ICONS: Readonly<Record<NavIcon, typeof Inbox>> = {
  inbox: Inbox,
  contacts: Users,
  kanban: KanbanSquare,
  ai: Bot,
  campaigns: Megaphone,
  dashboard: LayoutDashboard,
  settings: Settings,
};

interface NavigationRailProps {
  readonly items: readonly NavItem[];
  readonly unreadCount: number;
  readonly userName: string;
  readonly userTone: string;
  /** Foto real, se a pessoa enviou uma. Ausente = iniciais coloridas por `userTone`. */
  readonly userAvatarUrl?: string;
  readonly availability: AvailabilityStatus;
  readonly accessibleInboxes?: readonly AccessibleInbox[];
  readonly conversationCounts?: ConversationCounts;
  readonly canManageInboxes?: boolean;
  readonly roleName?: string;
}

export function NavigationRail({
  items,
  unreadCount,
  userName,
  userTone,
  userAvatarUrl,
  availability,
  accessibleInboxes = [],
  conversationCounts,
  canManageInboxes = false,
  roleName,
}: NavigationRailProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileInboxesOpen, setMobileInboxesOpen] = useState(false);

  /* ------------------------------------------------------------------ */
  /* Largura arrastável da barra.                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Começa fechada e só então lê a preferência salva.
   *
   * O servidor não tem `localStorage`, e ler no primeiro render do cliente faria
   * a marcação divergir da que veio do servidor — o React descarta a árvore
   * inteira quando isso acontece. Um efeito depois da montagem aplica a largura
   * guardada; o custo é um quadro com a barra fechada, que a transição esconde.
   */
  const [railWidth, setRailWidth] = useState(RAIL_MIN);
  const [dragging, setDragging] = useState(false);
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(RAIL_STORAGE_KEY);
      if (salvo) setRailWidth(clampRail(Number(salvo) || RAIL_MIN));
    } catch {
      // Navegador com armazenamento bloqueado: a barra abre no padrão e o
      // arrasto continua funcionando nesta sessão. Não é motivo para quebrar.
    }
  }, []);

  const persistirLargura = useCallback((largura: number) => {
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, String(largura));
    } catch {
      /* idem */
    }
  }, []);

  /**
   * O arrasto vive em `window`, não na alça.
   *
   * Quem arrasta rápido tira o ponteiro de uma alça de 8px muito antes de soltar
   * o botão; ouvindo só na alça, a barra congelaria no meio do movimento e
   * ficaria presa no modo de arrasto. `setPointerCapture` não serve aqui porque
   * o alvo é reconstruído a cada render de largura.
   */
  useEffect(() => {
    if (!dragging) return;

    const aoMover = (event: PointerEvent) => {
      const inicio = railRef.current?.getBoundingClientRect().left ?? 0;
      setRailWidth(clampRail(event.clientX - inicio));
    };
    const aoSoltar = () => {
      setDragging(false);
      setRailWidth((atual) => {
        // Solta perto do mínimo? Fecha de vez. Uma barra parada em 71px é uma
        // barra que ninguém quis — é o arrasto que não chegou.
        const final = atual < RAIL_LABEL_FROM - 24 ? RAIL_MIN : atual;
        persistirLargura(final);
        return final;
      });
    };

    window.addEventListener('pointermove', aoMover);
    window.addEventListener('pointerup', aoSoltar);
    window.addEventListener('pointercancel', aoSoltar);
    // Sem isto, arrastar seleciona o texto dos itens de menu no caminho.
    const cursorAnterior = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', aoMover);
      window.removeEventListener('pointerup', aoSoltar);
      window.removeEventListener('pointercancel', aoSoltar);
      document.body.style.cursor = cursorAnterior;
      document.body.style.userSelect = '';
    };
  }, [dragging, persistirLargura]);

  const expanded = railWidth >= RAIL_LABEL_FROM;

  /** Abre e fecha em um passo — o atalho de quem não quer arrastar. */
  const alternarLargura = useCallback(() => {
    setRailWidth((atual) => {
      const destino = atual >= RAIL_LABEL_FROM ? RAIL_MIN : 200;
      persistirLargura(destino);
      return destino;
    });
  }, [persistirLargura]);

  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const isActive = (item: NavItem): boolean =>
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`) ||
    (item.matches?.some((route) => pathname.startsWith(route)) ?? false);

  return (
    <>
      {/* ---------- Desktop: rail vertical, de largura arrastável ---------- */}
      <nav
        ref={railRef}
        aria-label="Navegação principal"
        style={{ width: railWidth }}
        className={cn(
          'relative hidden shrink-0 flex-col justify-between border-r border-line bg-surface py-3.5 shadow-xs md:flex',
          expanded ? 'items-stretch px-2.5' : 'items-center',
          // Sem transição enquanto o ponteiro manda: a largura ficaria sempre um
          // quadro atrás do cursor, e o arrasto pareceria travado.
          dragging ? '' : 'transition-[width] duration-150',
        )}
      >
        <div
          className={cn('flex w-full flex-col gap-2', expanded ? 'items-stretch' : 'items-center')}
        >
          {/* Logo Solint */}
          <Link
            href="/dashboard"
            aria-label="Solint CRM"
            className={cn(
              'mb-2 flex h-10 items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 font-display font-bold text-white shadow-md shadow-blue-500/25 transition-transform hover:scale-[1.03] active:scale-95',
              expanded ? 'gap-2.5 px-3' : 'size-10 justify-center',
            )}
          >
            <span className="text-base">S</span>
            {expanded ? <span className="truncate text-sm tracking-tight">Solint CRM</span> : null}
          </Link>

          {/* Itens de Navegação */}
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(item);

            // Caixas de entrada abre o menu flutuante inteligente
            if (item.id === 'conversas') {
              return (
                <InboxNavDropdown
                  key={item.id}
                  accessibleInboxes={accessibleInboxes}
                  totalUnreadCount={unreadCount}
                  conversationCounts={conversationCounts}
                  canManageInboxes={canManageInboxes}
                  roleName={roleName}
                  active={active}
                  expanded={expanded}
                  railWidth={railWidth}
                />
              );
            }

            return (
              <Link
                key={item.id}
                href={item.href}
                // O `title` só faz falta enquanto o nome não está na tela.
                {...(expanded ? {} : { title: item.label })}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center rounded-xl transition-all duration-150',
                  expanded ? 'h-10 w-full gap-3 px-2.5' : 'size-10 justify-center',
                  active
                    ? 'border border-brand/25 bg-brand/12 font-semibold text-brand shadow-xs'
                    : 'border border-transparent text-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                <Icon className="size-[19px] shrink-0 transition-transform group-hover:scale-110" />
                {expanded ? (
                  <span className="truncate text-xs font-semibold">{item.label}</span>
                ) : null}
              </Link>
            );
          })}
        </div>

        {/* Rodapé da Barra Lateral */}
        <div
          className={cn(
            'flex w-full flex-col gap-2.5',
            expanded ? 'items-stretch' : 'items-center',
          )}
        >
          <div
            className={cn(
              'flex gap-2',
              expanded ? 'items-center' : 'flex-col items-center gap-2.5',
            )}
          >
            <ThemeToggle />
            <LogoutButton />
          </div>

          <Link
            href="/perfil"
            aria-label={`Perfil de ${userName}`}
            {...(expanded ? {} : { title: userName })}
            className={cn(
              'flex items-center transition-all',
              expanded
                ? 'gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-surface-2'
                : 'justify-center rounded-full ring-2 ring-transparent hover:ring-brand/40',
            )}
          >
            <Avatar name={userName} tone={userTone} src={userAvatarUrl} size="sm" availability={availability} />
            {expanded ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-ink">{userName}</span>
                {roleName ? (
                  <span className="block truncate text-[10px] text-muted">{roleName}</span>
                ) : null}
              </span>
            ) : null}
          </Link>
        </div>

        {/*
          Alça de redimensionamento e expansão com símbolo visual.

          É um `separator` com `aria-valuenow` de propósito: quem navega pelo
          teclado também precisa conseguir abrir a barra, e as setas fazem o que
          o arrasto faz com o ponteiro. O clique na alça ou o duplo clique na
          linha alterna entre aberta e fechada.
        */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Largura da barra de navegação"
          aria-valuemin={RAIL_MIN}
          aria-valuemax={RAIL_MAX}
          aria-valuenow={railWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDoubleClick={alternarLargura}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              event.preventDefault();
              setRailWidth((atual) => {
                const destino = clampRail(atual + (event.key === 'ArrowRight' ? 24 : -24));
                persistirLargura(destino);
                return destino;
              });
            }
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              alternarLargura();
            }
          }}
          className="group absolute inset-y-0 -right-1.5 z-20 hidden w-3 cursor-col-resize items-center justify-center focus-visible:outline-none md:flex"
        >
          {/* Linha guia de arraste */}
          <span
            aria-hidden
            className={cn(
              'h-full w-0.5 rounded-full transition-colors',
              dragging
                ? 'bg-brand'
                : 'bg-transparent group-hover:bg-brand/40 group-focus-visible:bg-brand',
            )}
          />

          {/* Símbolo visual flutuante de arrasto / expansão */}
          <button
            type="button"
            tabIndex={-1}
            title={
              expanded
                ? 'Arrastar para redimensionar ou clique para recolher'
                : 'Arrastar para redimensionar ou clique para expandir'
            }
            onClick={(e) => {
              e.stopPropagation();
              alternarLargura();
            }}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 -right-1.5 flex h-7 w-3.5 cursor-pointer items-center justify-center rounded-full border border-line bg-surface shadow-2xs transition-all duration-150',
              'text-muted hover:border-brand/40 hover:bg-surface-2 hover:text-brand hover:scale-110 active:scale-95',
              dragging && 'border-brand bg-brand/10 text-brand ring-2 ring-brand/20',
            )}
          >
            <GripVertical className="size-2.5 shrink-0" />
          </button>
        </div>
      </nav>

      {/* ---------- Mobile: barra de topo ---------- */}
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir navegação"
          aria-expanded={drawerOpen}
          className="relative flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Menu className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-blue-500" />
          )}
        </button>

        <Link
          href="/dashboard"
          aria-label="Solint CRM"
          className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 font-display text-sm font-bold text-white"
        >
          S
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Link href="/perfil" aria-label={`Perfil de ${userName}`} className="ml-0.5">
            <Avatar name={userName} tone={userTone} src={userAvatarUrl} size="sm" availability={availability} />
          </Link>
        </div>
      </header>

      {/* ---------- Mobile: gaveta ---------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar navegação"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-xs"
          />
          <nav
            aria-label="Navegação principal"
            className="relative flex h-full w-64 flex-col border-r border-line bg-surface shadow-2xl animate-in slide-in-from-left-2 duration-200"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-display text-base font-bold tracking-tight text-ink">
                Solint CRM
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Fechar navegação"
                className="rounded-lg p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            <ul className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(item);

                if (item.id === 'conversas') {
                  return (
                    <li key={item.id} className="flex flex-col">
                      <div className="flex items-center gap-1">
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors',
                            active
                              ? 'bg-brand/12 font-semibold text-brand border border-brand/25'
                              : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
                          )}
                        >
                          <Icon className="size-[18px] shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          {unreadCount > 0 && (
                            <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                              {unreadCount}
                            </span>
                          )}
                        </Link>
                        <button
                          type="button"
                          onClick={() => setMobileInboxesOpen((v) => !v)}
                          className="flex size-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink"
                          title="Expandir caixas e conversas"
                        >
                          <ChevronDown
                            className={cn(
                              'size-4 transition-transform duration-150',
                              mobileInboxesOpen ? 'rotate-180 text-brand' : '',
                            )}
                          />
                        </button>
                      </div>

                      {mobileInboxesOpen && (
                        <div className="ml-4 mt-1 flex flex-col gap-2 border-l-2 border-line pl-2.5 py-1 animate-in fade-in duration-150">
                          {/* Conversas */}
                          {conversationCounts && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-dim px-1">
                                Conversas
                              </span>
                              <Link
                                href="/conversas"
                                className="flex items-center justify-between rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                              >
                                <span>Todas</span>
                                <span className="text-[10px] tabular-nums font-bold text-dim">
                                  {conversationCounts.todas}
                                </span>
                              </Link>
                              <Link
                                href="/conversas?scope=minhas"
                                className="flex items-center justify-between rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                              >
                                <span>Minhas</span>
                                <span className="text-[10px] tabular-nums font-bold text-dim">
                                  {conversationCounts.minhas}
                                </span>
                              </Link>
                              <Link
                                href="/conversas?scope=nao_atribuidas"
                                className="flex items-center justify-between rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                              >
                                <span>Não atendidas</span>
                                <span className="text-[10px] tabular-nums font-bold text-dim">
                                  {conversationCounts.nao_atribuidas}
                                </span>
                              </Link>
                              <Link
                                href="/conversas?unread=true"
                                className="flex items-center justify-between rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                              >
                                <span>Não lidas</span>
                                <span className="text-[10px] tabular-nums font-bold text-white bg-blue-600 rounded-full px-1">
                                  {conversationCounts.naoLidas}
                                </span>
                              </Link>
                            </div>
                          )}

                          {/* Canais */}
                          {accessibleInboxes.length > 0 && (
                            <div className="flex flex-col gap-0.5 pt-1 border-t border-line-soft">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-dim px-1">
                                Canais
                              </span>
                              {accessibleInboxes.map((inbox) => (
                                <Link
                                  key={inbox.id}
                                  href={`/conversas?caixa=${inbox.id}`}
                                  className="flex items-center justify-between rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                                >
                                  <span className="truncate">{inbox.name}</span>
                                  {inbox.unreadCount > 0 && (
                                    <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                                      {inbox.unreadCount}
                                    </span>
                                  )}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                }

                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors',
                        active
                          ? 'bg-brand/12 font-semibold text-brand border border-brand/25'
                          : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.id === 'conversas' && unreadCount > 0 && (
                        <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                          {unreadCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-line p-2.5">
              <Link
                href="/perfil"
                className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-2"
              >
                <Avatar name={userName} tone={userTone} src={userAvatarUrl} size="sm" availability={availability} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-ink">
                    {userName}
                  </span>
                  <span className="block text-[10px] text-muted">Ver perfil e preferências</span>
                </span>
              </Link>
              <LogoutButton variant="linha" className="mt-1 w-full" />
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
