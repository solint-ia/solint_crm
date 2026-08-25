'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { WhatsAppStatusPayload } from '@/infrastructure/whatsapp/whatsapp-events';

const INITIAL: WhatsAppStatusPayload = {
  status: 'desconectado',
  updatedAt: new Date(0).toISOString(),
};

type Listener = (status: WhatsAppStatusPayload) => void;

/**
 * Canal compartilhado de status do WhatsApp via Server-Sent Events (SSE).
 * Sem loops de polling desnecessários durante a navegação normal.
 */
const statusChannel = (() => {
  const listeners = new Set<Listener>();
  let source: EventSource | null = null;
  let last: WhatsAppStatusPayload = INITIAL;

  const notifyAll = (payload: WhatsAppStatusPayload) => {
    last = payload;
    for (const listener of listeners) listener(last);
  };

  const fetchStatus = async () => {
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
  };

  const open = () => {
    if (typeof window === 'undefined') return;
    if (source) return;

    // Busca status inicial apenas uma vez ao abrir o canal
    void fetchStatus();

    try {
      source = new EventSource('/api/whatsapp/events');

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
        }
      };
    },
  };
})();

/**
 * Estado da conexão do WhatsApp exposto para a interface.
 *
 * @param active desliga a inscrição quando o componente está oculto.
 */
export function useWhatsAppConnection(active = true) {
  const [statusData, setStatusData] = useState<WhatsAppStatusPayload>(statusChannel.snapshot);
  const [actionError, setActionError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!active) return;
    return statusChannel.subscribe(setStatusData);
  }, [active]);

  const call = useCallback((endpoint: string, fallback: string) => {
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
          // Dispara busca pontual do status apenas após a ação de conectar
          setTimeout(() => void statusChannel.fetchNow(), 400);
          setTimeout(() => void statusChannel.fetchNow(), 1500);
        } else {
          setActionError(data.error ?? fallback);
        }
      } catch {
        setActionError(fallback);
      }
    });
  }, []);

  const connect = useCallback(
    () => call('/api/whatsapp/connect', 'Erro ao iniciar conexão com WhatsApp'),
    [call],
  );

  const disconnect = useCallback(
    () => call('/api/whatsapp/disconnect', 'Erro ao desconectar WhatsApp'),
    [call],
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
