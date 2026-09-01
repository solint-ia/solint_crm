'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { platformUpdateInboxWebhookAction } from '@/app/(platform)/plataforma/actions';

export interface PlatformInbox {
  readonly id: string;
  readonly name: string;
  readonly channel: string;
  readonly identifier: string;
  readonly webhookUrl: string;
}

/**
 * Webhook dedicado de cada caixa.
 *
 * Este campo saiu de Configurações: quem usa o CRM não administra mais a
 * própria integração. Uma linha por caixa, cada uma salvando sozinha — salvar
 * tudo de uma vez faria um erro numa URL derrubar as outras alterações junto.
 */
export function AccountInboxWebhooksCard({
  accountId,
  inboxes,
}: {
  readonly accountId: string;
  readonly inboxes: readonly PlatformInbox[];
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <header className="flex items-center gap-2.5 border-b border-line pb-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Inbox className="size-4" />
        </div>
        <div>
          <h2 className="font-display text-sm font-bold text-ink">Webhook por caixa de entrada</h2>
          <p className="text-xs text-muted">
            Endpoint dedicado de um canal. Deixe vazio para desativar.
          </p>
        </div>
      </header>

      {inboxes.length === 0 ? (
        <p className="mt-4 text-xs text-muted">Esta conta não tem nenhuma caixa de entrada.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {inboxes.map((inbox) => (
            <InboxWebhookRow key={inbox.id} accountId={accountId} inbox={inbox} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InboxWebhookRow({
  accountId,
  inbox,
}: {
  readonly accountId: string;
  readonly inbox: PlatformInbox;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState(inbox.webhookUrl);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const sujo = url !== inbox.webhookUrl;

  const salvar = async () => {
    setErro(null);
    setSalvo(false);
    const res = await platformUpdateInboxWebhookAction({
      accountId,
      connectionId: inbox.id,
      webhookUrl: url.trim(),
    });
    if (!res.ok) {
      setErro(res.error ?? 'Erro ao salvar.');
      return;
    }
    setSalvo(true);
    router.refresh();
  };

  return (
    <li className="rounded-xl border border-line bg-surface-2/60 p-3">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-xs font-semibold text-ink">{inbox.name}</span>
        <span className="shrink-0 text-[11px] text-dim">
          {inbox.channel} · {inbox.identifier}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-dim" />
          <input
            type="url"
            placeholder="https://seu-sistema.com/api/webhooks/solint"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setSalvo(false);
            }}
            className="h-9 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-xs text-ink placeholder:text-dim outline-none focus:border-brand"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !sujo}
          onClick={() => startTransition(salvar)}
        >
          {pending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>

      {erro ? <p className="mt-1.5 text-[11px] text-red-text">{erro}</p> : null}
      {salvo && !sujo ? <p className="mt-1.5 text-[11px] text-muted">Salvo.</p> : null}
    </li>
  );
}
