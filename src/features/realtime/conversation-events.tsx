'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { ConversationEventPayload } from '@/infrastructure/whatsapp/whatsapp-events';

type Handler = (payload: ConversationEventPayload) => void;

interface EventsApi {
  readonly subscribe: (handler: Handler) => () => void;
}

const ConversationEventsContext = createContext<EventsApi | undefined>(undefined);

/**
 * Uma única conexão SSE para todo o workspace.
 *
 * Antes cada consumidor abria a sua: a caixa de entrada tinha uma, e o toast
 * abriria outra. O navegador limita conexões por origem em HTTP/1.1, e stream
 * aberto é caro no servidor — então quem transmite é um só, e quem escuta se
 * inscreve.
 */
export function ConversationEventsProvider({ children }: { readonly children: ReactNode }) {
  const handlers = useRef(new Set<Handler>());

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      source = new EventSource('/api/conversas/events');

      source.onmessage = (event) => {
        let payload: ConversationEventPayload;
        try {
          payload = JSON.parse(event.data) as ConversationEventPayload;
        } catch {
          return; // Heartbeat ou evento não-JSON.
        }
        for (const handler of [...handlers.current]) handler(payload);
      };

      source.onerror = () => {
        if (source) {
          source.close();
          source = null;
        }
        if (isMounted && !reconnectTimeout) {
          reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            connect();
          }, 2500);
        }
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (source) source.close();
    };
  }, []);

  const api = useMemo<EventsApi>(
    () => ({
      subscribe: (handler: Handler) => {
        handlers.current.add(handler);
        return () => {
          handlers.current.delete(handler);
        };
      },
    }),
    [],
  );

  return (
    <ConversationEventsContext.Provider value={api}>{children}</ConversationEventsContext.Provider>
  );
}

/**
 * Escuta os eventos de conversa. O handler pode mudar a cada render sem
 * derrubar a inscrição — quem se inscreve é um invólucro estável.
 */
export function useConversationEvents(handler: Handler): void {
  const context = useContext(ConversationEventsContext);
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!context) return;
    return context.subscribe((payload) => latest.current(payload));
  }, [context]);
}
