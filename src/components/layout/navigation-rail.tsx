'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot,
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
}

/**
 * Navegação global.
 *
 * Duas formas para a mesma informação: no desktop, a rail de 64px sempre
 * visível; abaixo de `md`, uma barra de topo com gaveta. Trocar por uma barra
 * inferior de abas custaria caro aqui — são sete destinos mais perfil, tema e
 * WhatsApp, e barra de abas só funciona bem com quatro ou cinco.
 */
export function NavigationRail({
  items,
  unreadCount,
  userName,
  userTone,
  availability,
}: NavigationRailProps) {
  const pathname = usePathname();
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { isConnected: waConnected, statusData } = useWhatsAppConnection();

  // Navegar fecha a gaveta: deixá-la aberta sobre a tela nova seria um beco.
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
        waConnected ? 'bg-status-open animate-pulse' : 'bg-status-pending',
      )}
    />
  );

  return (
    <>
      <WhatsAppModal open={isWhatsAppModalOpen} onClose={() => setIsWhatsAppModalOpen(false)} />

      {/* ---------- Desktop: rail vertical ---------- */}
      <nav
        aria-label="Navegação principal"
        className="hidden w-16 shrink-0 flex-col items-center justify-between border-r border-line bg-surface py-3.5 shadow-2xs md:flex"
      >
        <div className="flex w-full flex-col items-center gap-1.5">
          <Link
            href="/dashboard"
            aria-label="Solint CRM"
            className="mb-2 flex size-9.5 items-center justify-center rounded-surface bg-brand-gradient font-display text-title font-bold text-white shadow-xs transition-transform hover:scale-105 active:scale-95"
          >
            S
          </Link>

          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(item);
            return (
              <Link
                key={item.id}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex size-10 items-center justify-center rounded-surface transition-all duration-150',
                  active
                    ? 'bg-accent-soft font-semibold text-brand shadow-2xs'
                    : 'text-dim hover:bg-surface-2 hover:text-ink',
                )}
              >
                <Icon className="size-[19px] transition-transform group-hover:scale-105" />
                {item.id === 'conversas' && unreadCount > 0 ? (
                  <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-micro font-bold text-white shadow-xs">
                    {unreadCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsWhatsAppModalOpen(true)}
            title={whatsappTitle}
            aria-label="Status do WhatsApp"
            className="group relative flex size-9 items-center justify-center rounded-surface text-dim transition-all hover:bg-surface-2 hover:text-ink"
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
            className="rounded-full ring-2 ring-transparent transition-all hover:ring-brand/30"
          >
            <Avatar name={userName} tone={userTone} size="sm" availability={availability} />
          </Link>
        </div>
      </nav>

      {/* ---------- Mobile: barra de topo ---------- */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir navegação"
          aria-expanded={drawerOpen}
          className="relative flex size-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Menu className="size-5" />
          {unreadCount > 0 ? (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-brand" />
          ) : null}
        </button>

        <Link
          href="/dashboard"
          aria-label="Solint CRM"
          className="flex size-8 items-center justify-center rounded-surface bg-brand-gradient font-display text-body font-bold text-white"
        >
          S
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsWhatsAppModalOpen(true)}
            title={whatsappTitle}
            aria-label="Status do WhatsApp"
            className="relative flex size-9 items-center justify-center rounded-control text-dim transition-colors hover:bg-surface-2 hover:text-ink"
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
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar navegação"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/45"
          />
          <nav
            aria-label="Navegação principal"
            className="relative flex h-full w-64 flex-col border-r border-line bg-surface shadow-xl motion-safe:animate-[drawer-in_180ms_ease-out]"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-display text-title font-bold tracking-tight text-ink">
                Solint CRM
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Fechar navegação"
                className="rounded-control p-1 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(item);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-control px-3 py-2.5 text-ui transition-colors',
                        active
                          ? 'bg-accent-soft font-semibold text-brand'
                          : 'text-muted hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.id === 'conversas' && unreadCount > 0 ? (
                        <span className="rounded-full bg-brand px-1.5 text-micro font-bold text-white">
                          {unreadCount}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-line p-2">
              <Link
                href="/perfil"
                className="flex items-center gap-3 rounded-control px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <Avatar name={userName} tone={userTone} size="sm" availability={availability} />
                <span className="min-w-0">
                  <span className="block truncate text-body font-semibold text-ink">
                    {userName}
                  </span>
                  <span className="block text-meta text-dim">Ver perfil e preferências</span>
                </span>
              </Link>
              <LogoutButton variant="linha" className="mt-0.5 w-full" />
            </div>
          </nav>
        </div>
      ) : null}
    </>
  );
}
