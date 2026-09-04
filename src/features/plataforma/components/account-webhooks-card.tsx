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
  platformUpdateWebhookInboxesAction,
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
      'automaticamente, filtre data.key.fromMe === false na entrada; sem isso ' +
      'ele responde a propria resposta em laco.',
  },
  { id: 'conversa.criada', label: 'Conversa criada' },
  { id: 'conversa.resolvida', label: 'Conversa resolvida (ainda nao emitido)' },
  { id: 'contato.criado', label: 'Contato criado (ainda nao emitido)' },
];

/**
 * Chave das entregas que ficaram sem caixa.
 *
 * Um evento que não nasceu de uma conversa não tem `caixaEntradaId`, e a regra
 * do despachante é clara: só webhook de todas as caixas o recebe. Restringir o
 * escopo cancela essas entregas junto, então elas precisam de um lugar no mapa
 * de pendências — senão o aviso de "N entregas serão canceladas" mentiria por
 * omissão justamente no caso mais fácil de esquecer.
 */
export const WEBHOOK_SEM_CAIXA = '__sem_caixa__';

export interface PlatformWebhook {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly enabled: boolean;
  readonly failureCount: number;
  readonly allInboxes: boolean;
  readonly inboxIds: readonly string[];
  /** Entregas ainda na fila, por caixa. `WEBHOOK_SEM_CAIXA` guarda as sem caixa. */
  readonly pendingByInbox: Readonly<Record<string, number>>;
}

export interface PlatformWebhookInbox {
  readonly id: string;
  readonly name: string;
  readonly channel: string;
  readonly identifier: string;
  readonly status: string;
  /**
   * `Inbox.webhookUrl`, o campo da tela antiga.
   *
   * Ele nunca chegou ao despachante: cadastrar aqui não disparava nada. A
   * coluna fica por uma versão para permitir rollback, e o valor é mostrado
   * somente para que o superadministrador recadastre a URL como webhook da
   * conta antes de ela ser apagada.
   */
  readonly legacyWebhookUrl: string;
}

export function AccountWebhooksCard({
  accountId,
  webhooks,
  inboxes,
}: {
  readonly accountId: string;
  readonly webhooks: readonly PlatformWebhook[];
  readonly inboxes: readonly PlatformWebhookInbox[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [webhookToDelete, setWebhookToDelete] = useState<PlatformWebhook | null>(null);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [allInboxes, setAllInboxes] = useState(false);
  const [inboxIds, setInboxIds] = useState<readonly string[]>([]);
  const [events, setEvents] = useState<readonly string[]>([
    'mensagem.recebida',
    'mensagem.enviada',
    'conversa.criada',
  ]);

  const toggleEvento = (id: string) =>
    setEvents((atual) => (atual.includes(id) ? atual.filter((e) => e !== id) : [...atual, id]));

  const toggleInbox = (id: string) =>
    setInboxIds((current) =>
      current.includes(id) ? current.filter((inboxId) => inboxId !== id) : [...current, id],
    );

  const criar = async () => {
    setErro(null);
    const res = await platformCreateWebhookAction({
      accountId,
      name,
      url,
      events,
      secret: secret || undefined,
      allInboxes,
      inboxIds,
    });
    if (!res.ok) {
      setErro(res.error ?? 'Erro ao criar webhook.');
      return;
    }
    setName('');
    setUrl('');
    setSecret('');
    setAllInboxes(false);
    setInboxIds([]);
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
            <li key={hook.id} className="rounded-xl border border-line bg-surface-2/60 p-3">
              <div className="flex flex-wrap items-center gap-3">
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
                  <p className="text-[11px] text-muted">
                    {hook.events.join(', ') || 'sem eventos'}
                  </p>
                  <p className="text-[11px] font-medium text-violet-600 dark:text-violet-400">
                    {hook.allInboxes
                      ? 'Todas as caixas'
                      : `${hook.inboxIds.length} de ${inboxes.length} caixa(s)`}
                  </p>
                </div>

                <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                  <input
                    type="checkbox"
                    checked={hook.enabled}
                    disabled={pending}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      startTransition(async () => {
                        await platformToggleWebhookAction({
                          accountId,
                          webhookId: hook.id,
                          enabled,
                        });
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
              </div>

              <WebhookInboxScopeEditor accountId={accountId} webhook={hook} inboxes={inboxes} />
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

        <WebhookInboxSelector
          name="new-webhook-inbox-scope"
          allInboxes={allInboxes}
          selectedIds={inboxIds}
          inboxes={inboxes}
          onAllInboxesChange={setAllInboxes}
          onToggleInbox={toggleInbox}
          disabled={pending}
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
            responde sozinho, filtre <code>data.key.fromMe === false</code> logo na entrada; sem
            isso ele passa a responder a propria resposta, em laco.
          </p>
        ) : null}

        {erro ? <p className="text-[11px] text-red-text">{erro}</p> : null}

        <Button
          type="button"
          size="sm"
          className="w-fit"
          icon={<Plus className="size-3.5" />}
          disabled={
            pending ||
            !name.trim() ||
            !url.trim() ||
            events.length === 0 ||
            (!allInboxes && inboxIds.length === 0)
          }
          onClick={() => startTransition(criar)}
        >
          Adicionar webhook
        </Button>
      </div>

      <LegacyInboxWebhooks inboxes={inboxes} />

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

function WebhookInboxScopeEditor({
  accountId,
  webhook,
  inboxes,
}: {
  readonly accountId: string;
  readonly webhook: PlatformWebhook;
  readonly inboxes: readonly PlatformWebhookInbox[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [allInboxes, setAllInboxes] = useState(webhook.allInboxes);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(webhook.inboxIds);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const toggleInbox = (id: string) => {
    setSaved(null);
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((inboxId) => inboxId !== id) : [...current, id],
    );
  };

  const originalIds = [...webhook.inboxIds].sort().join('|');
  const currentIds = [...selectedIds].sort().join('|');
  const dirty = allInboxes !== webhook.allInboxes || currentIds !== originalIds;

  /**
   * O que a gravação vai descartar da fila.
   *
   * A conta segue a mesma regra do repositório: passar para "somente as
   * selecionadas" cancela toda entrega pendente cuja caixa ficou de fora, mais
   * as que não têm caixa nenhuma. Enquanto o webhook continuar valendo para
   * todas, nada é cancelado e não há o que confirmar.
   */
  const pendentesDescartadas = allInboxes
    ? []
    : Object.entries(webhook.pendingByInbox)
        .filter(([inboxId, total]) => total > 0 && !selectedIds.includes(inboxId))
        .map(([inboxId, total]) => ({
          inboxId,
          total,
          nome:
            inboxId === WEBHOOK_SEM_CAIXA
              ? 'Eventos sem caixa de entrada'
              : (inboxes.find((inbox) => inbox.id === inboxId)?.name ?? 'Caixa removida'),
        }));

  const totalDescartado = pendentesDescartadas.reduce((soma, linha) => soma + linha.total, 0);

  const save = async () => {
    setError(null);
    setSaved(null);
    const result = await platformUpdateWebhookInboxesAction({
      accountId,
      webhookId: webhook.id,
      allInboxes,
      inboxIds: selectedIds,
    });
    if (!result.ok) {
      setError(result.error ?? 'Erro ao atualizar as caixas.');
      return;
    }
    setConfirming(false);
    setSaved(
      result.canceledDeliveries
        ? `Escopo salvo. ${result.canceledDeliveries} entrega(s) pendente(s) cancelada(s).`
        : 'Escopo salvo.',
    );
    router.refresh();
  };

  return (
    <details className="mt-3 border-t border-line pt-2">
      <summary className="cursor-pointer text-[11px] font-semibold text-muted hover:text-ink">
        Configurar caixas autorizadas
      </summary>
      <div className="mt-3 flex flex-col gap-2">
        <WebhookInboxSelector
          name={`webhook-inbox-scope-${webhook.id}`}
          allInboxes={allInboxes}
          selectedIds={selectedIds}
          inboxes={inboxes}
          onAllInboxesChange={(value) => {
            setAllInboxes(value);
            setSaved(null);
          }}
          onToggleInbox={toggleInbox}
          disabled={pending}
        />

        {error ? <p className="text-[11px] text-red-text">{error}</p> : null}
        {saved && !dirty ? <p className="text-[11px] text-muted">{saved}</p> : null}

        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-fit"
          disabled={pending || !dirty || (!allInboxes && selectedIds.length === 0)}
          onClick={() => {
            if (totalDescartado > 0) {
              setConfirming(true);
              return;
            }
            startTransition(save);
          }}
        >
          {pending ? 'Salvando…' : 'Salvar caixas'}
        </Button>
      </div>

      <ConfirmModal
        open={confirming}
        title="Cancelar entregas pendentes"
        variant="warning"
        icon="warning"
        isLoading={pending}
        confirmLabel="Salvar e cancelar"
        description={
          <span className="block">
            Restringir este webhook descarta {totalDescartado} entrega(s) que ainda não saíram:
            <ul className="mt-2 flex flex-col gap-0.5">
              {pendentesDescartadas.map((linha) => (
                <li key={linha.inboxId} className="text-xs">
                  <strong className="text-ink">{linha.nome}</strong>: {linha.total} pendente(s)
                </li>
              ))}
            </ul>
            <span className="mt-2 block text-xs text-muted">
              Uma requisição que já esteja em andamento neste instante chega ao destino mesmo assim:
              o cancelamento vale para a fila, não para o que já saiu.
            </span>
          </span>
        }
        onClose={() => setConfirming(false)}
        onConfirm={() => startTransition(save)}
      />
    </details>
  );
}

/**
 * As URLs que ficaram na tela antiga.
 *
 * `Inbox.webhookUrl` era editável por caixa e **nunca foi lido pelo
 * despachante** — quem cadastrou ali acredita ter uma integração que jamais
 * disparou. Ligá-las agora, por migração automática, mandaria dados para
 * endereços que ninguém conferiu; então elas aparecem aqui apenas para serem
 * recadastradas à mão como webhook da conta.
 */
function LegacyInboxWebhooks({ inboxes }: { readonly inboxes: readonly PlatformWebhookInbox[] }) {
  const legadas = inboxes.filter((inbox) => inbox.legacyWebhookUrl.trim().length > 0);
  if (legadas.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
      <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
        URLs herdadas da configuração por caixa
      </p>
      <p className="mt-1 text-[11px] text-amber-700/90 dark:text-amber-400/90">
        Estes endereços foram cadastrados na tela antiga e nunca receberam evento nenhum. Recadastre
        os que ainda fizerem sentido como webhook da conta, marcando a caixa correspondente.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {legadas.map((inbox) => (
          <li key={inbox.id} className="min-w-0 text-[11px]">
            <span className="font-semibold text-ink">{inbox.name}</span>
            <span className="block truncate font-mono text-dim">{inbox.legacyWebhookUrl}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WebhookInboxSelector({
  name,
  allInboxes,
  selectedIds,
  inboxes,
  onAllInboxesChange,
  onToggleInbox,
  disabled,
}: {
  readonly name: string;
  readonly allInboxes: boolean;
  readonly selectedIds: readonly string[];
  readonly inboxes: readonly PlatformWebhookInbox[];
  readonly onAllInboxesChange: (value: boolean) => void;
  readonly onToggleInbox: (id: string) => void;
  readonly disabled: boolean;
}) {
  return (
    <fieldset className="rounded-xl border border-line bg-surface p-3">
      <legend className="px-1 text-[11px] font-semibold text-ink">Caixas autorizadas</legend>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="radio"
            name={name}
            checked={allInboxes}
            disabled={disabled}
            onChange={() => onAllInboxesChange(true)}
            className="size-3.5 accent-brand"
          />
          Todas as caixas, inclusive futuras
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="radio"
            name={name}
            checked={!allInboxes}
            disabled={disabled}
            onChange={() => onAllInboxesChange(false)}
            className="size-3.5 accent-brand"
          />
          Somente as selecionadas
        </label>
      </div>

      {!allInboxes ? (
        inboxes.length === 0 ? (
          <p className="mt-2 text-[11px] text-red-text">Esta conta ainda não possui caixas.</p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {inboxes.map((inbox) => (
              <label
                key={inbox.id}
                className="flex min-w-0 items-start gap-2 rounded-lg border border-line px-2.5 py-2 text-[11px] text-muted"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(inbox.id)}
                  disabled={disabled}
                  onChange={() => onToggleInbox(inbox.id)}
                  className="mt-0.5 size-3.5 shrink-0 accent-brand"
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{inbox.name}</span>
                  <span className="block truncate text-dim">
                    {inbox.channel} · {inbox.identifier} · {inbox.status}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )
      ) : null}
    </fieldset>
  );
}
