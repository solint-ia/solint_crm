'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { WhatsAppStatusPayload } from '@/infrastructure/whatsapp/whatsapp-events';

const INITIAL: WhatsAppStatusPayload = {
  status: 'desconectado',
  updatedAt: new Date(0).toISOString(),
};

type Listener = (status: WhatsAppStatusPayload) => void;

/**
 * Uma unica conexao SSE de status para a aplicacao inteira.
 * Rail, modal de pareamento e perfil observam o mesmo canal: abrir um
 * EventSource por componente esgotaria o limite de conexoes do navegador e
 * ainda permitiria que duas telas mostrassem estados divergentes.
 */
const statusChannel = (() => {
  const listeners = new Set<Listener>();
  let source: EventSource | null = null;
  let last: WhatsAppStatusPayload = INITIAL;

  const open = () => {
    if (source || typeof window === 'undefined') return;
    source = new EventSource('/api/whatsapp/events');
    source.onmessage = (event) => {
      try {
        last = JSON.parse(event.data) as WhatsAppStatusPayload;
      } catch {
        return; // Heartbeat ou evento não-JSON
      }
      for (const listener of listeners) listener(last);
    };
  };

  return {
    snapshot: () => last,
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
 * Estado da conexao do WhatsApp exposto para a interface.
 *
 * @param active desliga a inscricao quando o componente esta oculto (ex.: modal fechado).
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
        const data = (await response.json()) as { ok: boolean; error?: string };
        if (!data.ok) setActionError(data.error ?? fallback);
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
      isAwaitingQR: statusData.status === 'aguardando_leitura' && Boolean(statusData.qr),
      isConnecting: statusData.status === 'conectando' || statusData.status === 'gerando_qr',
      connect,
      disconnect,
    }),
    [statusData, actionError, isPending, connect, disconnect],
  );
}
