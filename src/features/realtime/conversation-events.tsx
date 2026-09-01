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
/**
 * Silêncio tolerado antes de considerar a conexão morta.
 *
 * O servidor manda uma batida a cada 15s (ver a rota `/api/conversas/events`).
 * Três intervalos de folga cobrem uma batida perdida e uma rede lenta sem
 * derrubar uma conexão que está apenas quieta.
 */
const SILENCIO_MAXIMO_MS = 50_000;

interface ConversationEventsProviderProps {
  readonly children: ReactNode;
  /**
   * A conta ativa da sessão. Não é usada para filtrar nada aqui — quem filtra é
   * o servidor —, mas **precisa** ser uma dependência do efeito.
   *
   * A rota `/api/conversas/events` resolve a conta uma única vez, no instante em
   * que a conexão abre, e a guarda no fecho do stream. Trocar de workspace
   * reassina o cookie e navega, mas a navegação do App Router **preserva** este
   * layout: sem esta dependência o `EventSource` continuava aberto, e o servidor
   * seguia empurrando eventos da conta anterior para dentro do workspace novo.
   * Passar a conta aqui derruba a conexão velha e abre outra já com o cookie
   * novo.
   */
  readonly accountId: string;
}

export function ConversationEventsProvider({
  children,
  accountId,
}: ConversationEventsProviderProps) {
  const handlers = useRef(new Set<Handler>());

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    const reconnect = (delay: number) => {
      if (source) {
        source.close();
        source = null;
      }
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      if (isMounted && !reconnectTimeout) {
        reconnectTimeout = setTimeout(() => {
          reconnectTimeout = null;
          connect();
        }, delay);
      }
    };

    /**
     * Vigia do silêncio.
     *
     * Um `EventSource` não avisa quando o outro lado morre sem fechar a
     * conexão — e é assim que ela morre na prática: o processo do servidor
     * reinicia, um intermediário corta o fluxo, e o `onerror` nunca dispara. A
     * aba ficava com um cano aberto para lugar nenhum, sem receber mais nada e
     * sem tentar de novo. Era metade do "o sininho às vezes nem toca": a outra
     * metade estava na janela de drenagem do worker.
     */
    const rearmarVigia = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        watchdog = null;
        reconnect(500);
      }, SILENCIO_MAXIMO_MS);
    };

    const connect = () => {
      if (!isMounted) return;
      source = new EventSource('/api/conversas/events');
      rearmarVigia();

      source.onopen = () => rearmarVigia();

      source.onmessage = (event) => {
        // Qualquer coisa que chegue prova que o canal está de pé — inclusive a
        // batida, que é justamente o que chega quando não há novidade.
        rearmarVigia();

        let payload: ConversationEventPayload;
        try {
          payload = JSON.parse(event.data) as ConversationEventPayload;
        } catch {
          return; // Evento não-JSON.
        }
        if ((payload as { type?: string }).type === 'heartbeat') return;
        for (const handler of [...handlers.current]) handler(payload);
      };

      source.onerror = () => reconnect(2500);
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (watchdog) clearTimeout(watchdog);
      if (source) source.close();
    };
  }, [accountId]);

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
