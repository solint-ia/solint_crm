'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Conversation } from '@/core/domain/conversation';
import type { Message } from '@/core/domain/message';
import { previewOfMessage } from '@/core/domain/message';
import type { AppNotification } from '@/core/domain/notification';
import { horaLabel } from '@/lib/datetime';
import { useConversationEvents } from './conversation-events';
import { playNotificationSound } from './notification-sound';

/**
 * Mensagens novas viram aviso no sininho — não cartão flutuante.
 *
 * O aviso de mensagem aparecia como toast no canto inferior da tela: sumia
 * sozinho em sete segundos, e quem estivesse fora do computador nesse intervalo
 * nunca soube que a mensagem chegou. O sininho é o lugar onde um aviso **fica**
 * até alguém olhar, e é onde as pessoas procuram por ele.
 *
 * O estado vive aqui, no layout do workspace, e não dentro do sininho: o
 * sininho é remontado a cada navegação, e o que ele guardasse morreria na
 * primeira troca de tela.
 *
 * Nada disto é gravado no banco. Uma linha por mensagem recebida duplicaria o
 * que a caixa de entrada já mostra — e o valor do aviso é chamar quem está
 * noutra tela agora, não montar um segundo histórico.
 */

interface LiveNotificationsApi {
  readonly items: readonly AppNotification[];
  readonly markRead: (id: string) => void;
  readonly markAllRead: () => void;
}

const LiveNotificationsContext = createContext<LiveNotificationsApi | undefined>(undefined);

/** Teto da lista. Além disso ninguém rola — vira ruído com aparência de dado. */
const MAX_ITEMS = 20;

export function LiveNotificationsProvider({
  soundEnabled,
  children,
}: {
  readonly soundEnabled: boolean;
  readonly children: ReactNode;
}) {
  const [items, setItems] = useState<readonly AppNotification[]>([]);

  /**
   * A preferência entra por `ref` porque o handler do barramento é registrado
   * uma vez: lida direto da prop, ele congelaria no valor do primeiro render e
   * desligar o som só teria efeito depois de recarregar a página.
   */
  const somLigado = useRef(soundEnabled);
  somLigado.current = soundEnabled;

  useConversationEvents((payload) => {
    // "Digitando" e recibo de entrega não são novidade para ninguém.
    if (payload.type === 'typing' || payload.type === 'message_updated') return;

    const conversation = payload.conversation as Conversation | undefined;
    const message =
      (payload.message as Message | undefined) ??
      [...(conversation?.timeline ?? [])].reverse().find((item) => item.kind === 'message')
        ?.message;

    // O eco das nossas próprias mensagens não avisa nada a quem as escreveu.
    if (!message || message.author !== 'contact' || message.deletedAt) return;

    const quem = conversation?.contact.name ?? message.authorName ?? 'Novo contato';
    const nova = payload.type === 'new_conversation';

    setItems((current) => {
      /**
       * Um aviso por conversa, sempre o mais recente.
       *
       * Sem isto, alguém mandando cinco linhas seguidas enterraria as outras
       * conversas sob cinco cópias de si mesmo — e o sininho passaria a medir
       * quem escreve mais, não quantos estão esperando.
       */
      const semDuplicata = current.filter(
        (item) => item.href !== `/conversas/${payload.conversationId}`,
      );
      const aviso: AppNotification = {
        id: `live-${payload.conversationId}-${message.id}`,
        accountId: payload.accountId,
        kind: 'mensagem',
        text: nova ? `${quem} iniciou uma conversa` : `${quem}: ${previewOfMessage(message)}`,
        timeLabel: horaLabel(new Date()),
        read: false,
        href: `/conversas/${payload.conversationId}`,
      };
      return [aviso, ...semDuplicata].slice(0, MAX_ITEMS);
    });

    if (somLigado.current) playNotificationSound();
  });

  const markRead = useCallback((id: string) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
  }, []);

  const markAllRead = useCallback(() => {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
  }, []);

  const api = useMemo<LiveNotificationsApi>(
    () => ({ items, markRead, markAllRead }),
    [items, markRead, markAllRead],
  );

  return (
    <LiveNotificationsContext.Provider value={api}>{children}</LiveNotificationsContext.Provider>
  );
}

/**
 * Fora do provider devolve uma lista vazia em vez de explodir: um sininho sem
 * avisos ao vivo é um defeito pequeno; uma tela em branco, um grande.
 */
export function useLiveNotifications(): LiveNotificationsApi {
  return (
    useContext(LiveNotificationsContext) ?? {
      items: [],
      markRead: () => undefined,
      markAllRead: () => undefined,
    }
  );
}
