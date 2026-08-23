'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { AtSign, Bell, Megaphone, Settings2, Timer, UserPlus } from 'lucide-react';
import type { AppNotification, NotificationKind } from '@/core/domain/notification';
import { cn } from '@/lib/cn';

interface NotificationsMenuProps {
  readonly notifications: readonly AppNotification[];
}

/** Cada tipo tem forma e cor próprias: a lista é varrida, não lida linha a linha. */
const KIND_ICON: Readonly<Record<NotificationKind, typeof Bell>> = {
  atribuicao: UserPlus,
  sla: Timer,
  campanha: Megaphone,
  mencao: AtSign,
  sistema: Settings2,
};

const KIND_TONE: Readonly<Record<NotificationKind, string>> = {
  atribuicao: 'text-blue-text',
  sla: 'text-red-text',
  campanha: 'text-violet-text',
  mencao: 'text-brand',
  sistema: 'text-dim',
};

export function NotificationsMenu({ notifications }: NotificationsMenuProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(notifications);
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = items.filter((item) => !item.read).length;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const markAllAsRead = () => setItems(items.map((item) => ({ ...item, read: true })));

  /** Abrir é ler: marcar individualmente evita zerar o que ainda não foi visto. */
  const markAsRead = (id: string) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Notificações${unread > 0 ? `, ${unread} não lidas` : ''}`}
        className="relative flex size-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Bell className="size-[18px]" />
        {unread > 0 ? (
          <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand" />
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            role="menu"
            className="absolute right-0 z-20 mt-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-float border border-line bg-surface shadow-xl"
          >
            <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="font-display text-body font-semibold text-ink">
                Notificações
                {unread > 0 ? (
                  <span className="ml-1.5 font-sans font-normal text-dim tabular-nums">
                    {unread} não lidas
                  </span>
                ) : null}
              </span>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="text-meta font-semibold text-brand hover:underline"
                >
                  Marcar todas como lidas
                </button>
              ) : null}
            </header>

            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-body text-dim">
                Nada por aqui. Avisos de atribuição, SLA e menções aparecem nesta lista.
              </p>
            ) : (
              <ul className="max-h-80 overflow-auto">
                {items.map((item) => {
                  const Icon = KIND_ICON[item.kind];
                  return (
                    <li key={item.id} className="flex items-stretch">
                      <Link
                        href={(item.href ?? '/dashboard') as Route}
                        onClick={() => {
                          markAsRead(item.id);
                          setOpen(false);
                        }}
                        className={cn(
                          'flex flex-1 gap-2.5 border-b border-line-soft px-4 py-3 transition-colors hover:bg-surface-2',
                          !item.read && 'bg-selected',
                        )}
                      >
                        <Icon className={cn('mt-0.5 size-3.5 shrink-0', KIND_TONE[item.kind])} />
                        <span className="min-w-0">
                          <span
                            className={cn(
                              'block text-body text-ink',
                              item.read ? 'font-normal' : 'font-semibold',
                            )}
                          >
                            {item.text}
                          </span>
                          <span className="mt-0.5 block text-meta text-dim">{item.timeLabel}</span>
                        </span>
                      </Link>

                      {!item.read ? (
                        <button
                          type="button"
                          onClick={() => markAsRead(item.id)}
                          aria-label={`Marcar como lida: ${item.text}`}
                          title="Marcar como lida"
                          className="flex shrink-0 items-center border-b border-line-soft px-3 text-dim transition-colors hover:bg-surface-2 hover:text-brand"
                        >
                          <span className="size-1.5 rounded-full bg-brand" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
