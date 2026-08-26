'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot,
  ChevronDown,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  Menu,
  QrCode,
  Settings,
  Users,
  X,
} from 'lucide-react';
import type { NavIcon, NavItem } from '@/config/navigation';
import type { AvailabilityStatus } from '@/core/domain/user';
import { Avatar } from '@/components/ui/avatar';
import { LogoutButton } from '@/features/auth/components/logout-button';
import { WhatsAppModal } from '@/features/whatsapp/components/whatsapp-modal';
import { useWhatsAppConnection } from '@/features/whatsapp/hooks/use-whatsapp-connection';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './theme-toggle';
import { InboxNavDropdown, type AccessibleInbox } from './inbox-nav-dropdown';

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
  readonly availability: AvailabilityStatus;
  readonly accessibleInboxes?: readonly AccessibleInbox[];
  readonly canManageInboxes?: boolean;
  readonly roleName?: string;
}

export function NavigationRail({
  items,
  unreadCount,
  userName,
  userTone,
  availability,
  accessibleInboxes = [],
  canManageInboxes = false,
  roleName,
}: NavigationRailProps) {
  const pathname = usePathname();
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileInboxesOpen, setMobileInboxesOpen] = useState(false);
  const { isConnected: waConnected, statusData } = useWhatsAppConnection();

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

  const whatsappTitle = waConnected
    ? `WhatsApp conectado${statusData.phone ? ` · ${statusData.phone}` : ''}`
    : 'Conectar WhatsApp (QR Code)';

  const whatsappDot = (
    <span
      className={cn(
        'absolute top-1.5 right-1.5 size-2 rounded-full border border-surface',
        waConnected ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse' : 'bg-amber-500',
      )}
    />
  );

  return (
    <>
      <WhatsAppModal open={isWhatsAppModalOpen} onClose={() => setIsWhatsAppModalOpen(false)} />

      {/* ---------- Desktop: rail vertical ---------- */}
      <nav
        aria-label="Navegação principal"
        className="hidden w-16 shrink-0 flex-col items-center justify-between border-r border-line bg-surface py-3.5 shadow-xs md:flex"
      >
        <div className="flex w-full flex-col items-center gap-2">
          {/* Logo Solint */}
          <Link
            href="/dashboard"
            aria-label="Solint CRM"
            className="mb-2 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 font-display text-base font-bold text-white shadow-md shadow-blue-500/25 transition-transform hover:scale-105 active:scale-95"
          >
            S
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
                  canManageInboxes={canManageInboxes}
                  roleName={roleName}
                  active={active}
                />
              );
            }

            return (
              <Link
                key={item.id}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex size-10 items-center justify-center rounded-xl transition-all duration-150',
                  active
                    ? 'bg-brand/12 font-semibold text-brand border border-brand/25 shadow-xs'
                    : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
                )}
              >
                <Icon className="size-[19px] transition-transform group-hover:scale-110" />
              </Link>
            );
          })}
        </div>

        {/* Rodapé da Barra Lateral */}
        <div className="flex flex-col items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsWhatsAppModalOpen(true)}
            title={whatsappTitle}
            aria-label="Status do WhatsApp"
            className="group relative flex size-9 items-center justify-center rounded-xl text-muted transition-all hover:bg-surface-2 hover:text-ink border border-transparent hover:border-line-soft"
          >
            <QrCode className="size-[18px] transition-transform group-hover:scale-105" />
            {whatsappDot}
          </button>

          <ThemeToggle />
          <LogoutButton />
          <Link
            href="/perfil"
            aria-label={`Perfil de ${userName}`}
            title={userName}
            className="rounded-full ring-2 ring-transparent transition-all hover:ring-brand/40"
          >
            <Avatar name={userName} tone={userTone} size="sm" availability={availability} />
          </Link>
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
          <button
            type="button"
            onClick={() => setIsWhatsAppModalOpen(true)}
            title={whatsappTitle}
            aria-label="Status do WhatsApp"
            className="relative flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <QrCode className="size-[18px]" />
            {whatsappDot}
          </button>
          <ThemeToggle />
          <Link href="/perfil" aria-label={`Perfil de ${userName}`} className="ml-0.5">
            <Avatar name={userName} tone={userTone} size="sm" availability={availability} />
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
            className="relative flex h-full w-64 flex-col border-r border-line bg-surface shadow-2xl animate-in slide-in-from-left duration-200"
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

                if (item.id === 'conversas' && accessibleInboxes.length > 0) {
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
                          title="Expandir caixas"
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
                        <ul className="ml-5 mt-1 flex flex-col gap-1 border-l-2 border-line pl-3 py-1 animate-in fade-in duration-150">
                          <li>
                            <Link
                              href="/conversas"
                              className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                            >
                              <span>Todas as caixas</span>
                              {unreadCount > 0 && (
                                <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                                  {unreadCount}
                                </span>
                              )}
                            </Link>
                          </li>
                          {accessibleInboxes.map((inbox) => (
                            <li key={inbox.id}>
                              <Link
                                href={`/conversas?caixa=${inbox.id}`}
                                className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                              >
                                <span className="truncate">{inbox.name}</span>
                                {inbox.unreadCount > 0 && (
                                  <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                                    {inbox.unreadCount}
                                  </span>
                                )}
                              </Link>
                            </li>
                          ))}
                        </ul>
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
                <Avatar name={userName} tone={userTone} size="sm" availability={availability} />
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
