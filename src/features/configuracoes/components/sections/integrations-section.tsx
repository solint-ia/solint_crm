'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Copy,
  Key,
  Link2,
  Plus,
  QrCode,
  Radio,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react';
import type { ApiToken, ChannelConnection, Webhook } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Toggle } from '@/components/ui/toggle';
import {
  CONNECTION_STATUS_LABEL,
  CONNECTION_STATUS_TONE,
} from '@/components/domain/presentation-maps';
import { WhatsAppModal } from '@/features/whatsapp/components/whatsapp-modal';
import {
  createApiTokenAction,
  createWebhookAction,
  deleteApiTokenAction,
  deleteWebhookAction,
  toggleWebhookAction,
} from '@/app/(workspace)/configuracoes/actions';
import { cn } from '@/lib/cn';
import { APP_TIMEZONE } from '@/lib/datetime';

interface IntegrationsSectionProps {
  readonly connections: readonly ChannelConnection[];
  readonly webhooks: readonly Webhook[];
  readonly apiTokens: readonly ApiToken[];
}

const AVAILABLE_EVENTS = [
  'conversa.criada',
  'conversa.resolvida',
  'contato.criado',
  'mensagem.recebida',
] as const;

export function IntegrationsSection({
  connections,
  webhooks,
  apiTokens,
}: IntegrationsSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [waTarget, setWaTarget] = useState<ChannelConnection | null>(null);

  // Webhook Modal
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
  const [deletingWebhook, setDeletingWebhook] = useState<Webhook | null>(null);
  const [webhookName, setWebhookName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>(['conversa.criada']);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookError, setWebhookError] = useState<string | null>(null);

  // Token Modal
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [revokingToken, setRevokingToken] = useState<ApiToken | null>(null);
  const [tokenName, setTokenName] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setWebhookError(null);
    startTransition(async () => {
      const res = await createWebhookAction({
        name: webhookName,
        url: webhookUrl,
        events: webhookEvents,
        ...(webhookSecret.trim() ? { secret: webhookSecret.trim() } : {}),
      });
      if (res.ok) {
        setIsWebhookModalOpen(false);
        setWebhookName('');
        setWebhookUrl('');
        setWebhookEvents(['conversa.criada']);
        setWebhookSecret('');
        router.refresh();
      } else {
        setWebhookError(res.error ?? 'Erro ao criar webhook.');
      }
    });
  };

  const handleToggleWebhook = (webhookId: string, currentStatus: boolean) => {
    startTransition(async () => {
      await toggleWebhookAction({ webhookId, enabled: !currentStatus });
      router.refresh();
    });
  };

  const handleConfirmDeleteWebhook = async () => {
    if (!deletingWebhook) return;
    startTransition(async () => {
      await deleteWebhookAction({ webhookId: deletingWebhook.id });
      setDeletingWebhook(null);
      router.refresh();
    });
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setTokenError(null);
    startTransition(async () => {
      const res = await createApiTokenAction({ name: tokenName });
      if (res.ok && res.rawSecret) {
        setGeneratedSecret(res.rawSecret);
        router.refresh();
      } else {
        setTokenError(res.error ?? 'Erro ao gerar token.');
      }
    });
  };

  const handleConfirmRevokeToken = async () => {
    if (!revokingToken) return;
    startTransition(async () => {
      await deleteApiTokenAction({ tokenId: revokingToken.id });
      setRevokingToken(null);
      router.refresh();
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-200">
      <WhatsAppModal
        open={isWhatsAppModalOpen}
        onClose={() => {
          setIsWhatsAppModalOpen(false);
          setWaTarget(null);
          router.refresh();
        }}
        inboxId={waTarget?.id}
        inboxName={waTarget?.name}
      />

      {/* ============================================================ */}
      {/* 1. CANAIS DE MENSAGEM                                        */}
      {/* ============================================================ */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 border-b border-line pb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Radio className="size-4" />
            </div>
            <h3 className="font-display text-lg font-bold text-ink">
              Canais de mensagem
            </h3>
          </div>
          <p className="text-xs text-muted">
            Conexões ativas e canais de entrada de conversas configurados no CRM.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {connections.map((conn) => {
            const isWa = conn.channel === 'whatsapp';
            return (
              <div
                key={conn.id}
                className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-5 shadow-2xs transition-all hover:border-brand/40 hover:shadow-xs"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-ink truncate">
                      {conn.name}
                    </span>
                    <Badge tone={CONNECTION_STATUS_TONE[conn.status]} withDot>
                      {CONNECTION_STATUS_LABEL[conn.status]}
                    </Badge>
                  </div>

                  <span className="mt-1 block text-xs text-muted">
                    {conn.provider} · {conn.channel}
                  </span>

                  <div className="mt-3 rounded-xl border border-line-soft bg-surface-2/60 px-3 py-2">
                    <span className="font-mono text-xs font-semibold text-ink">
                      {conn.identifier}
                    </span>
                  </div>

                  <div className="mt-2 text-[11px] text-dim">
                    Última sincronização: hoje às {new Date().toLocaleTimeString('pt-BR', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                <div className="mt-5 flex gap-2 border-t border-line-soft pt-4">
                  {isWa ? (
                    <Button
                      variant={conn.status === 'conectado' ? 'secondary' : 'primary'}
                      size="sm"
                      className="flex-1 justify-center"
                      icon={<QrCode className="size-3.5" />}
                      onClick={() => {
                        setWaTarget(conn);
                        setIsWhatsAppModalOpen(true);
                      }}
                    >
                      {conn.status === 'conectado' ? 'Gerenciar QR' : 'Conectar WhatsApp'}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 justify-center"
                      onClick={() => router.push('/configuracoes?secao=caixas')}
                    >
                      Gerenciar canal
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============================================================ */}
      {/* 2. WEBHOOKS DE SAÍDA                                         */}
      {/* ============================================================ */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <WebhookIcon className="size-4" />
              </div>
              <h3 className="font-display text-lg font-bold text-ink">
                Webhooks de saída
              </h3>
            </div>
            <p className="mt-1 text-xs text-muted">
              Receba notificações de eventos em tempo real em URLs externas.
            </p>
          </div>

          <Button
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => setIsWebhookModalOpen(true)}
          >
            Novo webhook
          </Button>
        </div>

        {webhooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2/40 p-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-dim mb-3">
              <WebhookIcon className="size-5" />
            </div>
            <h4 className="font-display text-sm font-bold text-ink">
              Nenhum webhook cadastrado
            </h4>
            <p className="mt-1 max-w-sm text-xs text-muted">
              Configure endpoints HTTP para receber disparos automáticos de novas mensagens e conversas.
            </p>
            <Button
              size="sm"
              className="mt-4"
              icon={<Plus className="size-3.5" />}
              onClick={() => setIsWebhookModalOpen(true)}
            >
              Criar primeiro webhook
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-2xs">
            <div className="divide-y divide-line-soft">
              {webhooks.map((wh) => {
                const webhookTitle = wh.url.replace(/^https?:\/\//, '');
                return (
                  <div
                    key={wh.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-surface-2/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-ink truncate font-mono">
                          {webhookTitle}
                        </span>
                        <Badge tone={wh.enabled ? 'green' : 'slate'} withDot>
                          {wh.enabled ? 'Ativo' : 'Pausado'}
                        </Badge>
                      </div>

                      <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted truncate">
                        <Link2 className="size-3 text-dim shrink-0" />
                        <span className="truncate">{wh.url}</span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1">
                        {wh.events.map((ev) => (
                          <span
                            key={ev}
                            className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted border border-line-soft"
                          >
                            {ev}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <Toggle
                        checked={wh.enabled}
                        onChange={() => handleToggleWebhook(wh.id, wh.enabled)}
                        label={`Alternar status do webhook ${webhookTitle}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Excluir webhook"
                        onClick={() => setDeletingWebhook(wh)}
                        icon={<Trash2 className="size-3.5 text-red-500" />}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/* 3. TOKENS DE API                                             */}
      {/* ============================================================ */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Key className="size-4" />
              </div>
              <h3 className="font-display text-lg font-bold text-ink">
                Tokens de API
              </h3>
            </div>
            <p className="mt-1 text-xs text-muted">
              Gerencie chaves de acesso para integrações e rotinas automatizadas externas.
            </p>
          </div>

          <Button
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              setGeneratedSecret(null);
              setTokenName('');
              setIsTokenModalOpen(true);
            }}
          >
            Gerar token
          </Button>
        </div>

        {apiTokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2/40 p-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-dim mb-3">
              <Key className="size-5" />
            </div>
            <h4 className="font-display text-sm font-bold text-ink">
              Nenhum token gerado
            </h4>
            <p className="mt-1 max-w-sm text-xs text-muted">
              Crie credenciais de autenticação para conectar sistemas legados, ERPs e bots via REST API.
            </p>
            <Button
              size="sm"
              className="mt-4"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                setGeneratedSecret(null);
                setTokenName('');
                setIsTokenModalOpen(true);
              }}
            >
              Gerar primeiro token
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-2xs">
            <div className="divide-y divide-line-soft">
              {apiTokens.map((tok) => (
                <div
                  key={tok.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-surface-2/50"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-ink">
                        {tok.name}
                      </span>
                      <Badge tone="blue">Ativo</Badge>
                    </div>

                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <span>Criado {tok.createdLabel}</span>
                      <span>·</span>
                      <span className="font-mono text-dim">
                        {tok.maskedValue}
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    onClick={() => setRevokingToken(tok)}
                  >
                    Revogar token
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Modal Novo Webhook */}
      <Modal
        open={isWebhookModalOpen}
        onClose={() => setIsWebhookModalOpen(false)}
        title="Cadastrar novo webhook"
        description="Configure uma URL pública para receber requisições POST seguras."
        className="max-w-md"
      >
        <form onSubmit={handleCreateWebhook} className="flex flex-col gap-4 pt-1">
          {webhookError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {webhookError}
            </p>
          ) : null}

          <div>
            <label htmlFor="webhook-name" className="mb-1 block text-xs font-semibold text-ink">
              Identificação do webhook
            </label>
            <input
              id="webhook-name"
              type="text"
              required
              placeholder="Ex: ERP Faturamento, Notificador Discord"
              value={webhookName}
              onChange={(e) => setWebhookName(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label htmlFor="webhook-url" className="mb-1 block text-xs font-semibold text-ink">
              URL do endpoint (HTTPS obrigatório)
            </label>
            <input
              id="webhook-url"
              type="url"
              required
              placeholder="https://seu-servidor.com/webhooks"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label htmlFor="webhook-secret" className="mb-1 block text-xs font-semibold text-ink">
              Chave de verificação <span className="font-normal text-muted">(opcional)</span>
            </label>
            <input
              id="webhook-secret"
              type="text"
              minLength={16}
              placeholder="mínimo 16 caracteres"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
            <p className="mt-1 text-[11px] text-muted">
              Cada envio vai assinado no cabeçalho <code>X-Solint-Signature</code>. Guarde a mesma
              chave do outro lado para confirmar que a chamada veio daqui.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink">
              Eventos inscritos
            </label>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_EVENTS.map((ev) => {
                const checked = webhookEvents.includes(ev);
                return (
                  <button
                    type="button"
                    key={ev}
                    onClick={() =>
                      setWebhookEvents((prev) =>
                        checked ? prev.filter((item) => item !== ev) : [...prev, ev],
                      )
                    }
                    className={cn(
                      'flex items-center gap-2 rounded-xl border p-2 text-left text-xs transition-all',
                      checked
                        ? 'border-brand bg-blue-500/10 font-bold text-blue-600 dark:text-blue-400'
                        : 'border-line bg-surface text-muted hover:bg-surface-2',
                    )}
                  >
                    <span className={cn('size-2 rounded-full', checked ? 'bg-brand' : 'bg-line')} />
                    <span className="font-mono text-[11px] truncate">{ev}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setIsWebhookModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || !webhookName.trim() || !webhookUrl.trim() || webhookEvents.length === 0}
            >
              {isPending ? 'Cadastrando…' : 'Salvar webhook'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Gerar Token */}
      <Modal
        open={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        title={generatedSecret ? 'Token criado com sucesso' : 'Gerar token de API'}
        description={
          generatedSecret
            ? 'Copie a chave agora. Por razões de segurança, ela não será exibida novamente.'
            : 'Defina um nome de referência para esta credencial.'
        }
        className="max-w-md"
      >
        {generatedSecret ? (
          <div className="flex flex-col gap-4 pt-1">
            <div className="rounded-xl border border-line-soft bg-surface-2 p-3">
              <span className="text-[11px] font-semibold text-dim uppercase">Chave de acesso:</span>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold text-ink break-all select-all">
                  {generatedSecret}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
                  onClick={() => handleCopy(generatedSecret)}
                >
                  {copied ? 'Copiado!' : 'Copiar'}
                </Button>
              </div>
            </div>

            <div className="flex justify-end border-t border-line pt-4">
              <Button onClick={() => setIsTokenModalOpen(false)}>Concluir</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateToken} className="flex flex-col gap-4 pt-1">
            {tokenError ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                {tokenError}
              </p>
            ) : null}

            <div>
              <label htmlFor="token-name" className="mb-1 block text-xs font-semibold text-ink">
                Finalidade / Nome da chave
              </label>
              <input
                id="token-name"
                type="text"
                required
                placeholder="Ex: Integração Bling ERP, Zapier"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setIsTokenModalOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending || !tokenName.trim()}>
                {isPending ? 'Gerando…' : 'Gerar token'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Confirmação de Exclusão de Webhook */}
      <ConfirmModal
        open={deletingWebhook !== null}
        title="Excluir webhook"
        description={
          <span>
            Deseja realmente remover o webhook{' '}
            <strong className="font-mono text-ink">{deletingWebhook?.url}</strong>? As notificações enviadas para esta URL serão descontinuadas imediatamente.
          </span>
        }
        confirmLabel="Excluir webhook"
        variant="danger"
        isLoading={isPending}
        onClose={() => setDeletingWebhook(null)}
        onConfirm={handleConfirmDeleteWebhook}
      />

      {/* Confirmação de Revogação de Token */}
      <ConfirmModal
        open={revokingToken !== null}
        title="Revogar token de API"
        description={
          <span>
            Tem certeza que deseja revogar o token{' '}
            <strong className="font-semibold text-ink">{revokingToken?.name}</strong>? Qualquer sistema externo que esteja autenticando com esta chave perderá o acesso instantaneamente.
          </span>
        }
        confirmLabel="Revogar credencial"
        variant="danger"
        isLoading={isPending}
        onClose={() => setRevokingToken(null)}
        onConfirm={handleConfirmRevokeToken}
      />
    </div>
  );
}
