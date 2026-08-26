'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
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

  const fetchStatus = async () => {
    if (!inboxId) {
      try {
        const res = await fetch('/api/whatsapp/status', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; status?: WhatsAppStatusPayload };
          if (data.ok && data.status) {
            notifyAll(data.status);
          }
        }
      } catch {
        // Silencioso
      }
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
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!active) return;
    return channel.subscribe(setStatusData);
  }, [active, channel]);

  const call = useCallback(
    (endpoint: string, fallback: string) => {
      setActionError(undefined);
      startTransition(async () => {
        try {
          const response = await fetch(endpoint, { method: 'POST' });
          const data = (await response.json()) as {
            ok: boolean;
            error?: string;
            status?: WhatsAppStatusPayload;
          };

          if (data.ok) {
            if (data.status) {
              setStatusData(data.status);
            }
            setTimeout(() => void channel.fetchNow(), 400);
            setTimeout(() => void channel.fetchNow(), 1500);
          } else {
            setActionError(data.error ?? fallback);
          }
        } catch {
          setActionError(fallback);
        }
      });
    },
    [channel],
  );

  const connect = useCallback(
    () =>
      call(
        inboxId ? `/api/inboxes/${inboxId}/whatsapp/connect` : '/api/whatsapp/connect',
        'Erro ao iniciar conexão com WhatsApp',
      ),
    [call, inboxId],
  );

  const disconnect = useCallback(
    () =>
      call(
        inboxId ? `/api/inboxes/${inboxId}/whatsapp/disconnect` : '/api/whatsapp/disconnect',
        'Erro ao desconectar WhatsApp',
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
