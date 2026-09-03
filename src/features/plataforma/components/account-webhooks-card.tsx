'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import type { WebhookEvent } from '@/infrastructure/webhooks/webhook-dispatch';
import {
  platformCreateWebhookAction,
  platformDeleteWebhookAction,
  platformToggleWebhookAction,
} from '@/app/(platform)/plataforma/actions';

/**
 * Os eventos oferecidos.
 *
 * `conversa.resolvida` e `contato.criado` continuam na lista por compatibilidade
 * com quem ja os marcou, mas **nenhuma linha do despachante os emite hoje**: o
 * unico ponto de disparo e o caminho da mensagem.
 */
const EVENTOS: readonly {
  readonly id: WebhookEvent;
  readonly label: string;
  readonly aviso?: string;
}[] = [
  { id: 'mensagem.recebida', label: 'Mensagem recebida' },
  {
    id: 'mensagem.enviada',
    label: 'Mensagem enviada',
    aviso:
      'Inclui o que o proprio CRM manda. Se o fluxo do outro lado responde ' +
      'automaticamente, filtre data.key.fromMe === false na entrada — sem isso ' +
      'ele responde a propria resposta em laco.',
  },
  { id: 'conversa.criada', label: 'Conversa criada' },
  { id: 'conversa.resolvida', label: 'Conversa resolvida (ainda nao emitido)' },
  { id: 'contato.criado', label: 'Contato criado (ainda nao emitido)' },
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
  const [webhookToDelete, setWebhookToDelete] = useState<PlatformWebhook | null>(null);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<readonly string[]>([
    'mensagem.recebida',
    'mensagem.enviada',
    'conversa.criada',
  ]);

  const toggleEvento = (id: string) =>
    setEvents((atual) => (atual.includes(id) ? atual.filter((e) => e !== id) : [...atual, id]));

  const criar = async () => {
    setErro(null);
    const res = await platformCreateWebhookAction({
      accountId,
      name,
      url,
      events,
      secret: secret || undefined,
    });
    if (!res.ok) {
      setErro(res.error ?? 'Erro ao criar webhook.');
      return;
    }
    setName('');
    setUrl('');
    setSecret('');
    setEvents(['mensagem.recebida', 'mensagem.enviada', 'conversa.criada']);
    router.refresh();
  };

  const excluir = async () => {
    if (!webhookToDelete) return;
    setErro(null);
    const res = await platformDeleteWebhookAction({
      accountId,
      webhookId: webhookToDelete.id,
    });
    if (!res.ok) {
      setErro(res.error ?? 'Erro ao excluir webhook.');
      return;
    }
    setWebhookToDelete(null);
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
                onClick={() => setWebhookToDelete(hook)}
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
            <label
              key={evento.id}
              title={evento.aviso}
              className="flex items-center gap-1.5 text-[11px] text-muted"
            >
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

        {/* O aviso do laco fica ao lado da caixa que o causa, e nao na
            documentacao: quem marca "Mensagem enviada" precisa ler no momento
            em que marca. */}
        {events.includes('mensagem.enviada') ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            O corpo enviado inclui as mensagens que o proprio CRM manda. Se o fluxo do outro lado
            responde sozinho, filtre <code>data.key.fromMe === false</code> logo na entrada — sem
            isso ele passa a responder a propria resposta, em laco.
          </p>
        ) : null}

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

      <ConfirmModal
        open={webhookToDelete !== null}
        title="Excluir webhook"
        description={
          <span>
            Excluir o webhook <strong className="text-ink">{webhookToDelete?.name}</strong>? Ele
            deixará de receber eventos desta conta imediatamente.
          </span>
        }
        confirmLabel="Excluir webhook"
        variant="danger"
        onClose={() => setWebhookToDelete(null)}
        onConfirm={excluir}
      />
    </section>
  );
}
