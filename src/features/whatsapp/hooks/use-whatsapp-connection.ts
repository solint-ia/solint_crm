'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WhatsAppStatusPayload } from '@/infrastructure/whatsapp/whatsapp-events';

const INITIAL: WhatsAppStatusPayload = {
  status: 'desconectado',
  updatedAt: new Date(0).toISOString(),
};

type Listener = (status: WhatsAppStatusPayload) => void;

interface StatusChannel {
  snapshot: () => WhatsAppStatusPayload;
  fetchNow: () => Promise<void>;
  subscribe: (listener: Listener) => () => void;
}

const channels = new Map<string, StatusChannel>();

const getStatusChannel = (inboxId?: string): StatusChannel => {
  const key = inboxId ?? 'global';
  let ch = channels.get(key);
  if (!ch) {
    ch = createStatusChannel(inboxId);
    channels.set(key, ch);
  }
  return ch;
};

const createStatusChannel = (inboxId?: string): StatusChannel => {
  const listeners = new Set<Listener>();
  let source: EventSource | null = null;
  let last: WhatsAppStatusPayload = INITIAL;

  const notifyAll = (payload: WhatsAppStatusPayload) => {
    last = payload;
    for (const listener of listeners) listener(last);
  };

  /**
   * Leitura pontual, para não depender só do SSE.
   *
   * Tinha um `if (!inboxId)` em volta de tudo: para caixa específica esta
   * função não fazia absolutamente nada. Como o modal sempre passa `inboxId`,
   * na prática **nunca** havia leitura pontual — o estado inicial embutido
   * ("desconectado") ficava na tela até o primeiro evento do SSE chegar, e as
   * duas rechamadas depois de conectar/desconectar caíam no vazio.
   */
  const fetchStatus = async () => {
    const url = inboxId ? `/api/inboxes/${inboxId}/whatsapp/status` : '/api/whatsapp/status';
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; status?: WhatsAppStatusPayload };
      if (data.ok && data.status) notifyAll(data.status);
    } catch {
      // Silencioso: o SSE continua sendo a fonte principal.
    }
  };

  const open = () => {
    if (typeof window === 'undefined') return;
    if (source) return;

    void fetchStatus();

    try {
      const sseUrl = inboxId ? `/api/inboxes/${inboxId}/whatsapp/events` : '/api/whatsapp/events';
      source = new EventSource(sseUrl);

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as WhatsAppStatusPayload;
          notifyAll(payload);
        } catch {
          // Heartbeat ou evento não-JSON
        }
      };

      source.onerror = () => {
        // Se a conexão SSE oscilar, tenta reconectar silenciosamente
      };
    } catch {
      // EventSource não suportado
    }
  };

  return {
    snapshot: () => last,
    fetchNow: fetchStatus,
    subscribe(listener: Listener) {
      listeners.add(listener);
      open();
      listener(last);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          source?.close();
          source = null;
          channels.delete(inboxId ?? 'global');
        }
      };
    },
  };
};

/**
 * Estado da conexão do WhatsApp exposto para a interface.
 *
 * @param active desliga a inscrição quando o componente está oculto.
 * @param inboxId id específico da caixa para multi-inbox, ou omitido para rota global.
 */
export function useWhatsAppConnection(active = true, inboxId?: string) {
  const channel = useMemo(() => getStatusChannel(inboxId), [inboxId]);
  const [statusData, setStatusData] = useState<WhatsAppStatusPayload>(channel.snapshot);
  const [actionError, setActionError] = useState<string | undefined>();
  /**
   * Estado comum, e não `useTransition`.
   *
   * O pendente de uma transição é atualização de baixa prioridade por
   * definição: o React tem liberdade para adiar a pintura dele. Na prática o
   * botão só virava "Iniciando..." bem depois do clique, e quem clicava achava
   * que não tinha acontecido nada — e clicava de novo. Aqui o feedback precisa
   * ser imediato, então é estado normal, marcado antes do `fetch` sair.
   */
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!active) return;
    return channel.subscribe(setStatusData);
  }, [active, channel]);

  const call = useCallback(
    async (endpoint: string, fallback: string, otimista: WhatsAppStatusPayload['status']) => {
      setActionError(undefined);
      setIsPending(true);

      /**
       * O estado otimista entra antes do `fetch`.
       *
       * Sem ele, entre o clique e a primeira resposta do worker a tela seguia
       * dizendo "Desconectado" — que é justamente o que o usuário está tentando
       * mudar. O worker confirma (ou desmente) logo em seguida, pelo SSE ou
       * pela leitura pontual abaixo.
       */
      setStatusData((atual) => ({
        ...atual,
        status: otimista,
        qr: undefined,
        error: undefined,
        updatedAt: new Date().toISOString(),
      }));

      try {
        const response = await fetch(endpoint, { method: 'POST' });
        const data = (await response.json()) as {
          ok: boolean;
          error?: string;
          status?: unknown;
        };

        if (!data.ok) {
          setActionError(data.error ?? fallback);
          await channel.fetchNow();
          return;
        }

        /**
         * A rota por caixa devolve `status` como **texto** (`'conectando'`), e
         * a global devolve o payload inteiro. Confiar cegamente nisso gravava a
         * string no lugar do objeto: `statusData.status` virava `undefined`,
         * todos os sinalizadores da tela davam falso e o badge caía em
         * "Desconectado" — exatamente o sintoma de "cliquei e ele disse que
         * desconectou". Só objeto é aceito; o resto vem da leitura pontual.
         */
        if (data.status && typeof data.status === 'object') {
          setStatusData(data.status as WhatsAppStatusPayload);
        }
      } catch {
        setActionError(fallback);
      } finally {
        setIsPending(false);
      }

      // O worker leva um instante para publicar o QR. Duas leituras espaçadas
      // cobrem o caso de o SSE ainda não ter entregue nada.
      void channel.fetchNow();
      setTimeout(() => void channel.fetchNow(), 800);
      setTimeout(() => void channel.fetchNow(), 2_000);
    },
    [channel],
  );

  const connect = useCallback(
    () =>
      call(
        inboxId ? `/api/inboxes/${inboxId}/whatsapp/connect` : '/api/whatsapp/connect',
        'Erro ao iniciar conexão com WhatsApp',
        'conectando',
      ),
    [call, inboxId],
  );

  const disconnect = useCallback(
    () =>
      call(
        inboxId ? `/api/inboxes/${inboxId}/whatsapp/disconnect` : '/api/whatsapp/disconnect',
        'Erro ao desconectar WhatsApp',
        'desconectado',
      ),
    [call, inboxId],
  );

  return useMemo(
    () => ({
      statusData,
      errorMessage: actionError ?? statusData.error,
      isPending,
      isConnected: statusData.status === 'conectado',
      isAwaitingQR:
        statusData.status === 'aguardando_leitura' ||
        (statusData.status === 'gerando_qr' && Boolean(statusData.qr)),
      isConnecting:
        statusData.status === 'conectando' ||
        (statusData.status === 'gerando_qr' && !statusData.qr) ||
        (statusData.status === 'aguardando_leitura' && !statusData.qr),
      connect,
      disconnect,
    }),
    [statusData, actionError, isPending, connect, disconnect],
  );
}
