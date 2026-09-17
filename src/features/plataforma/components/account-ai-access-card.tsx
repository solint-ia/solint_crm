'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Loader2, Unplug } from 'lucide-react';
import { setAccountAiAgentAccessAction } from '@/app/(platform)/plataforma/account-actions';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';

export function AccountAiAccessCard({
  accountId,
  accountName,
  initialEnabled,
}: {
  readonly accountId: string;
  readonly accountName: string;
  readonly initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  const updateAccess = (next: boolean) => {
    setMessage(undefined);
    startTransition(async () => {
      const result = await setAccountAiAgentAccessAction({ accountId, enabled: next });
      if (!result.ok) {
        setMessage({
          tone: 'error',
          text: result.error ?? 'Não foi possível alterar o acesso ao agente de IA.',
        });
        return;
      }

      setEnabled(next);
      setConfirmingDisconnect(false);
      setMessage({
        tone: 'success',
        text: next ? 'Agente de IA conectado a esta conta.' : 'Agente de IA desconectado.',
      });
      router.refresh();
    });
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
            <Bot className="size-4.5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-sm font-bold text-ink">Agente de IA</h2>
              <span
                className={
                  enabled
                    ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300'
                    : 'rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-muted'
                }
              >
                {enabled ? 'Conectado' : 'Sem acesso'}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
              Controla a área de agentes e os botões Iniciar IA e Pausar IA em todas as conversas
              desta conta. Desconectar preserva agentes e configurações.
            </p>
          </div>
        </div>

        {enabled ? (
          <Button
            variant="danger"
            size="sm"
            icon={
              pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Unplug className="size-3.5" />
              )
            }
            disabled={pending}
            onClick={() => setConfirmingDisconnect(true)}
          >
            Desconectar agente de IA
          </Button>
        ) : (
          <Button
            size="sm"
            icon={
              pending ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />
            }
            disabled={pending}
            onClick={() => updateAccess(true)}
          >
            Conectar agente de IA
          </Button>
        )}
      </div>

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`mt-3 text-xs font-medium ${
            message.tone === 'error' ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <ConfirmModal
        open={confirmingDisconnect}
        title="Desconectar agente de IA?"
        description={
          <>
            Os controles de IA desaparecerão de <strong>{accountName}</strong> e o agente externo
            deixará de responder. As configurações existentes serão preservadas.
          </>
        }
        confirmLabel="Desconectar"
        variant="warning"
        icon="warning"
        isLoading={pending}
        onClose={() => setConfirmingDisconnect(false)}
        onConfirm={() => updateAccess(false)}
      />
    </section>
  );
}
