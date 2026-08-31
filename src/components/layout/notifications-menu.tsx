'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AtSign,
  Bell,
  Megaphone,
  MessageSquare,
  Settings2,
  Timer,
  UserPlus,
} from 'lucide-react';
import type { AppNotification, NotificationKind } from '@/core/domain/notification';
import { useLiveNotifications } from '@/features/realtime/live-notifications';
import {
  markAllNotificationsAsReadAction,
  markConversationNotificationsAsReadAction,
  markNotificationAsReadAction,
} from './notification-actions';
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
  mensagem: MessageSquare,
};

const KIND_TONE: Readonly<Record<NotificationKind, string>> = {
  atribuicao: 'text-blue-text',
  sla: 'text-red-text',
  campanha: 'text-violet-text',
  mencao: 'text-brand',
  sistema: 'text-dim',
  mensagem: 'text-green-text',
};

export function NotificationsMenu({ notifications }: NotificationsMenuProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(notifications);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Duas origens, uma lista.
   *
   * As gravadas vêm do servidor com a página; as de mensagem nova chegam pelo
   * barramento de tempo real e vivem no layout, que não é remontado a cada
   * navegação. Misturá-las só na exibição mantém cada uma com o ciclo de vida
   * que ela tem — e é o que faz o "marcar como lida" continuar significando
   * coisas diferentes para cada uma sem que a tela precise saber disso.
   */
  const live = useLiveNotifications();
  const visible = [...live.items, ...items];
  const unread = visible.filter((item) => !item.read).length;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const markAllAsRead = () => {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    live.markAllRead();
    void markAllNotificationsAsReadAction();
  };

  /**
   * Abrir é ler: marcar individualmente evita zerar o que ainda não foi visto.
   *
   * Quando o aviso leva a uma conversa, apagam-se **todos** os avisos dela — e
   * não só o clicado. Cinco mensagens do mesmo contato não são cinco coisas a
   * ler: são uma conversa, e ela está sendo aberta agora. Marcar só um deixava
   * o selo apontando para a tela em que a pessoa acabou de entrar.
   */
  const markAsRead = (id: string, href?: string) => {
    const conversationId = href?.startsWith('/conversas/')
      ? href.slice('/conversas/'.length).split(/[?#]/)[0]
      : undefined;

    setItems((current) =>
      current.map((item) =>
        item.id === id || (conversationId && item.href === href) ? { ...item, read: true } : item,
      ),
    );

    if (conversationId) {
      live.markConversationRead(conversationId);
      void markConversationNotificationsAsReadAction(conversationId);
      return;
    }

    live.markRead(id);
    if (!id.startsWith('live-')) {
      void markNotificationAsReadAction(id);
    }
  };

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
        {/* O número, não um ponto. O ponto dizia "há algo"; a pergunta que
            alguém faz de relance é "quanto". Acima de nove vira "9+" porque a
            diferença entre 12 e 30 não muda decisão nenhuma e o algarismo a
            mais deforma o selo. */}
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold tabular-nums text-white">
            {unread > 9 ? '9+' : unread}
          </span>
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

            {visible.length === 0 ? (
              <p className="px-4 py-6 text-center text-body text-dim">
                Nada por aqui. Avisos de atribuição, SLA e menções aparecem nesta lista.
              </p>
            ) : (
              <ul className="max-h-80 overflow-auto">
                {visible.map((item) => {
                  const Icon = KIND_ICON[item.kind];
                  return (
                    <li key={item.id} className="flex items-stretch">
                      <Link
                        href={(item.href ?? '/dashboard') as Route}
                        onClick={() => {
                          markAsRead(item.id, item.href);
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
                          onClick={() => markAsRead(item.id, item.href)}
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
