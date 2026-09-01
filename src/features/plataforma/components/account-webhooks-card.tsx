'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WebhookEvent } from '@/infrastructure/webhooks/webhook-dispatch';
import {
  platformCreateWebhookAction,
  platformDeleteWebhookAction,
  platformToggleWebhookAction,
} from '@/app/(platform)/plataforma/actions';

/** Os quatro eventos que o despachante realmente sabe emitir hoje. */
const EVENTOS: readonly { readonly id: WebhookEvent; readonly label: string }[] = [
  { id: 'mensagem.recebida', label: 'Mensagem recebida' },
  { id: 'conversa.criada', label: 'Conversa criada' },
  { id: 'conversa.resolvida', label: 'Conversa resolvida' },
  { id: 'contato.criado', label: 'Contato criado' },
];

export interface PlatformWebhook {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly enabled: boolean;
  readonly failureCount: number;
}

export function AccountWebhooksCard({
  accountId,
  webhooks,
}: {
  readonly accountId: string;
  readonly webhooks: readonly PlatformWebhook[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<readonly string[]>(['mensagem.recebida']);

  const toggleEvento = (id: string) =>
    setEvents((atual) =>
      atual.includes(id) ? atual.filter((e) => e !== id) : [...atual, id],
    );

  const criar = async () => {
    setErro(null);
    const res = await platformCreateWebhookAction({ accountId, name, url, events, secret: secret || undefined });
    if (!res.ok) {
      setErro(res.error ?? 'Erro ao criar webhook.');
      return;
    }
    setName('');
    setUrl('');
    setSecret('');
    setEvents(['mensagem.recebida']);
    router.refresh();
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <header className="flex items-center gap-2.5 border-b border-line pb-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
          <WebhookIcon className="size-4" />
        </div>
        <div>
          <h2 className="font-display text-sm font-bold text-ink">Webhooks da conta</h2>
          <p className="text-xs text-muted">
            Um POST assinado a cada evento. O segredo assina em{' '}
            <code className="font-mono text-[11px]">X-Solint-Signature</code>.
          </p>
        </div>
      </header>

      {webhooks.length === 0 ? (
        <p className="mt-4 text-xs text-muted">Nenhum webhook nesta conta.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {webhooks.map((hook) => (
            <li
              key={hook.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-semibold text-ink">{hook.name}</span>
                  {hook.failureCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-red-soft px-2 py-0.5 text-[10px] font-semibold text-red-text">
                      {hook.failureCount} falha(s)
                    </span>
                  ) : null}
                </div>
                <p className="truncate font-mono text-[11px] text-dim">{hook.url}</p>
                <p className="text-[11px] text-muted">{hook.events.join(', ') || 'sem eventos'}</p>
              </div>

              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={hook.enabled}
                  disabled={pending}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    startTransition(async () => {
                      await platformToggleWebhookAction({ accountId, webhookId: hook.id, enabled });
                      router.refresh();
                    });
                  }}
                  className="size-3.5 accent-brand"
                />
                Ativo
              </label>

              <button
                type="button"
                disabled={pending}
                aria-label={`Excluir webhook ${hook.name}`}
                onClick={() =>
                  startTransition(async () => {
                    await platformDeleteWebhookAction({ accountId, webhookId: hook.id });
                    router.refresh();
                  })
                }
                className="shrink-0 rounded-lg p-1.5 text-dim transition-colors hover:bg-red-soft hover:text-red-text"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Nome (ex.: ERP do cliente)"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-9 rounded-xl border border-line bg-surface px-3 text-xs text-ink placeholder:text-dim outline-none focus:border-brand"
          />
          <input
            type="url"
            placeholder="https://sistema.com/webhooks/solint"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="h-9 rounded-xl border border-line bg-surface px-3 text-xs text-ink placeholder:text-dim outline-none focus:border-brand"
          />
        </div>

        <input
          type="text"
          placeholder="Segredo de assinatura (mínimo 16 caracteres, opcional)"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          className="h-9 rounded-xl border border-line bg-surface px-3 text-xs text-ink placeholder:text-dim outline-none focus:border-brand"
        />

        <div className="flex flex-wrap gap-3">
          {EVENTOS.map((evento) => (
            <label key={evento.id} className="flex items-center gap-1.5 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={events.includes(evento.id)}
                onChange={() => toggleEvento(evento.id)}
                className="size-3.5 accent-brand"
              />
              {evento.label}
            </label>
          ))}
        </div>

        {erro ? <p className="text-[11px] text-red-text">{erro}</p> : null}

        <Button
          type="button"
          size="sm"
          className="w-fit"
          icon={<Plus className="size-3.5" />}
          disabled={pending || !name.trim() || !url.trim() || events.length === 0}
          onClick={() => startTransition(criar)}
        >
          Adicionar webhook
        </Button>
      </div>
    </section>
  );
}
