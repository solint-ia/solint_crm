'use client';

import { useEffect, useRef, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FbSdk {
  init(options: Record<string, unknown>): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

interface SignupConfig {
  readonly enabled: boolean;
  readonly appId?: string;
  readonly configId?: string;
  readonly graphVersion?: string;
}

interface SessionInfo {
  phoneNumberId?: string;
  wabaId?: string;
  businessId?: string;
  event?: string;
}

const carregarSdk = (config: SignupConfig): Promise<FbSdk> =>
  new Promise((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: config.appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: config.graphVersion,
      });
      if (window.FB) resolve(window.FB);
      else reject(new Error('SDK da Meta indisponível.'));
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('Não foi possível carregar o SDK da Meta.'));
    document.body.appendChild(script);
  });

/**
 * "Conectar com a Meta": o cadastro incorporado (Embedded Signup v4).
 *
 * Só aparece quando a plataforma está configurada como Tech Provider
 * (`META_APP_ID`, `META_APP_SECRET`, `META_ES_CONFIG_ID`). O código que o popup
 * devolve vale 30 segundos, então ele segue para o servidor no mesmo instante;
 * os ids do número chegam por `postMessage`, às vezes antes, às vezes depois do
 * callback — por isso os dois são juntados antes de enviar.
 */
export function EmbeddedSignupButton({
  inboxId,
  onConnected,
}: {
  readonly inboxId: string;
  readonly onConnected: () => void;
}) {
  const [config, setConfig] = useState<SignupConfig>();
  const [coexistence, setCoexistence] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const info = useRef<SessionInfo>({});

  useEffect(() => {
    let vivo = true;
    void fetch(`/api/inboxes/${inboxId}/whatsapp/cloud/embedded-signup`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { ok?: boolean } & SignupConfig) => {
        if (vivo && data.ok) setConfig(data);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [inboxId]);

  useEffect(() => {
    const ouvir = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (data.event === 'CANCEL') {
          setPending(false);
          return;
        }
        if (data.event === 'ERROR') {
          setError(data.data?.error_message ?? 'A Meta interrompeu o cadastro.');
          setPending(false);
          return;
        }
        info.current = {
          phoneNumberId: data.data?.phone_number_id,
          wabaId: data.data?.waba_id,
          businessId: data.data?.business_id,
          event: data.event,
        };
      } catch {
        // Mensagem de outra origem do Facebook, que não é do cadastro.
      }
    };
    window.addEventListener('message', ouvir);
    return () => window.removeEventListener('message', ouvir);
  }, []);

  if (!config?.enabled) return null;

  const concluir = async (code: string) => {
    // Os ids podem chegar logo depois do callback.
    for (let i = 0; i < 20 && !info.current.phoneNumberId; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const response = await fetch(`/api/inboxes/${inboxId}/whatsapp/cloud/embedded-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        phoneNumberId: info.current.phoneNumberId,
        wabaId: info.current.wabaId,
        businessId: info.current.businessId,
        event: info.current.event ?? 'FINISH',
      }),
    });
    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok) throw new Error(data.error ?? 'Falha ao concluir o cadastro.');
    onConnected();
  };

  const abrir = async () => {
    setError(undefined);
    setPending(true);
    info.current = {};
    try {
      const fb = await carregarSdk(config);
      fb.login(
        (response) => {
          const code = response.authResponse?.code;
          if (!code) {
            setPending(false);
            return;
          }
          void concluir(code)
            .catch((erro: unknown) =>
              setError(erro instanceof Error ? erro.message : 'Falha ao concluir o cadastro.'),
            )
            .finally(() => setPending(false));
        },
        {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            sessionInfoVersion: '3',
            ...(coexistence ? { featureType: 'whatsapp_business_app_onboarding' } : {}),
          },
        },
      );
    } catch (erro) {
      setError(erro instanceof Error ? erro.message : 'Não foi possível abrir o cadastro da Meta.');
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-control border border-line bg-surface p-3">
      <Button
        variant="primary"
        size="md"
        onClick={() => void abrir()}
        disabled={pending}
        icon={<BadgeCheck className="size-4" />}
      >
        {pending ? 'Aguardando a Meta…' : 'Conectar com a Meta'}
      </Button>
      <label className="flex items-start gap-2 text-meta text-muted">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={coexistence}
          onChange={(event) => setCoexistence(event.target.checked)}
        />
        <span>
          Continuar usando o app WhatsApp Business neste número (coexistência). Aparelhos conectados
          são desvinculados, grupos deixam de ser atendidos e o histórico de até 180 dias é
          importado.
        </span>
      </label>
      {error ? <p className="text-meta text-red-text">{error}</p> : null}
    </div>
  );
}
