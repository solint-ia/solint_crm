'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Plus, QrCode, Trash2 } from 'lucide-react';
import type { ApiToken, ChannelConnection, Webhook } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';

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

  // Webhook Modal
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
  const [deletingWebhook, setDeletingWebhook] = useState<Webhook | null>(null);
  const [webhookName, setWebhookName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>(['conversa.criada']);
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
      });
      if (res.ok) {
        setIsWebhookModalOpen(false);
        setWebhookName('');
        setWebhookUrl('');
        setWebhookEvents(['conversa.criada']);
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

  const handleCopySecret = () => {
    if (!generatedSecret) return;
    navigator.clipboard.writeText(generatedSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <WhatsAppModal
        open={isWhatsAppModalOpen}
        onClose={() => setIsWhatsAppModalOpen(false)}
      />

      {/* Modal Novo Webhook */}
      <Modal
        open={isWebhookModalOpen}
        onClose={() => setIsWebhookModalOpen(false)}
        title="Cadastrar novo webhook"
      >
        <form onSubmit={handleCreateWebhook} className="flex flex-col gap-4">
          {webhookError && (
            <div className="rounded-md bg-danger/10 p-3 text-body text-danger">
              {webhookError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Nome da integração</label>
            <input
              type="text"
              required
              placeholder="Ex: ERP Solint"
              value={webhookName}
              onChange={(e) => setWebhookName(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">URL de destino (POST)</label>
            <input
              type="url"
              required
              placeholder="https://seu-sistema.com/api/webhook"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-2 block text-meta font-medium text-ink">Eventos escutados</label>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-body text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={webhookEvents.includes(ev)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setWebhookEvents([...webhookEvents, ev]);
                      } else {
                        setWebhookEvents(webhookEvents.filter((item) => item !== ev));
                      }
                    }}
                    className="rounded border-line text-primary focus:ring-primary"
                  />
                  <span className="font-mono text-meta">{ev}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsWebhookModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || webhookEvents.length === 0}>
              {isPending ? 'Salvando...' : 'Salvar webhook'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Gerar Token */}
      <Modal
        open={isTokenModalOpen}
        onClose={() => {
          setIsTokenModalOpen(false);
          setGeneratedSecret(null);
          setTokenName('');
        }}
        title={generatedSecret ? 'Token de API gerado com sucesso' : 'Gerar novo token de API'}
      >
        {generatedSecret ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-md bg-amber-500/10 p-3 text-body text-amber-600 dark:text-amber-400">
              ⚠️ <strong>Atenção:</strong> Esta chave não será exibida novamente. Copie e guarde em um local seguro.
            </div>
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Chave de acesso secreta</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={generatedSecret}
                  className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-body text-ink select-all"
                />
                <Button variant="secondary" onClick={handleCopySecret} icon={copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}>
                  {copied ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
            </div>
            <div className="mt-4 flex justify-end border-t border-line-soft pt-3">
              <Button
                onClick={() => {
                  setIsTokenModalOpen(false);
                  setGeneratedSecret(null);
                  setTokenName('');
                }}
              >
                Concluir
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateToken} className="flex flex-col gap-4">
            {tokenError && (
              <div className="rounded-md bg-danger/10 p-3 text-body text-danger">
                {tokenError}
              </div>
            )}
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Identificação do token</label>
              <input
                type="text"
                required
                placeholder="Ex: Integração n8n ou Zapier"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              />
            </div>
            <p className="text-meta text-muted">
              O token terá permissão total para ler e gravar contatos, conversas e oportunidades via API REST.
            </p>
            <div className="mt-4 flex justify-end gap-2 border-t border-line-soft pt-3">
              <Button variant="ghost" type="button" onClick={() => setIsTokenModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending || !tokenName.trim()}>
                {isPending ? 'Gerando...' : 'Gerar token'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-title font-bold text-ink tracking-tight">
              Canais de mensageria e caixas de entrada
            </h3>
            <p className="text-body text-muted">
              Conexões ativas para envio e recebimento de mensagens.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setIsWhatsAppModalOpen(true)}
            icon={<QrCode className="size-3.5" />}
          >
            Conectar WhatsApp (QR Code)
          </Button>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => {
            const isWa = conn.name.toLowerCase().includes('whatsapp');
            return (
              <Card key={conn.id} className="flex flex-col justify-between p-4.5">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ui font-bold text-ink tracking-tight">
                      {conn.name}
                    </span>
                    <Badge tone={CONNECTION_STATUS_TONE[conn.status]}>
                      {CONNECTION_STATUS_LABEL[conn.status]}
                    </Badge>
                  </div>
                  <div className="mt-1 text-meta text-muted">{conn.provider}</div>
                  <div className="mt-2.5 font-mono text-body text-ink font-semibold tracking-tight">
                    {conn.identifier}
                  </div>
                </div>
                <div className="mt-4 border-t border-line-soft pt-3">
                  <Button
                    variant={isWa ? 'primary' : 'secondary'}
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => {
                      if (isWa) setIsWhatsAppModalOpen(true);
                    }}
                  >
                    {isWa ? 'Conectar / Gerenciar QR' : 'Gerenciar canal'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-title font-bold text-ink tracking-tight">
              Webhooks de saída
            </h3>
            <p className="text-body text-muted">
              Notificações de eventos em tempo real para URLs externas.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => setIsWebhookModalOpen(true)}
          >
            Novo webhook
          </Button>
        </div>

        <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
          <div className="divide-y divide-line-soft">
            {webhooks.length === 0 ? (
              <div className="p-4 text-center text-body text-muted">Nenhum webhook cadastrado.</div>
            ) : (
              webhooks.map((wh) => (
                <div
                  key={wh.id}
                  className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-surface-2/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-body font-semibold text-ink truncate">
                      {wh.url}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {wh.events.map((ev) => (
                        <Badge key={ev} tone="blue">
                          {ev}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleWebhook(wh.id, wh.enabled)}
                      className="cursor-pointer"
                    >
                      <Badge tone={wh.enabled ? 'green' : 'slate'}>
                        {wh.enabled ? 'Ativo' : 'Pausado'}
                      </Badge>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Excluir webhook"
                      onClick={() => setDeletingWebhook(wh)}
                      icon={<Trash2 className="size-3.5 text-danger" />}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-title font-bold text-ink tracking-tight">
              Tokens de API
            </h3>
            <p className="text-body text-muted">
              Chaves de acesso programático para integrações e rotinas automatizadas.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => setIsTokenModalOpen(true)}
          >
            Gerar token
          </Button>
        </div>

        <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
          <div className="divide-y divide-line-soft">
            {apiTokens.length === 0 ? (
              <div className="p-4 text-center text-body text-muted">Nenhum token gerado.</div>
            ) : (
              apiTokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-surface-2/60"
                >
                  <div>
                    <div className="text-ui font-bold text-ink tracking-tight">
                      {token.name}
                    </div>
                    <div className="mt-1 font-mono text-body text-muted font-medium">
                      {token.maskedValue}
                    </div>
                    <div className="mt-1.5 text-meta text-dim">
                      Criado em {token.createdLabel} · Último uso: {token.lastUsedLabel}
                    </div>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setRevokingToken(token)}
                  >
                    Revogar
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modal Confirmação Exclusão Webhook */}
      <ConfirmModal
        open={deletingWebhook !== null}
        title="Excluir webhook"
        description={
          <span>
            Tem certeza que deseja excluir o webhook para a URL{' '}
            <strong className="font-mono text-ink text-meta">{deletingWebhook?.url}</strong>? Disparos de eventos para este destino serão interrompidos imediatamente.
          </span>
        }
        confirmLabel="Excluir webhook"
        variant="danger"
        isLoading={isPending}
        onClose={() => setDeletingWebhook(null)}
        onConfirm={handleConfirmDeleteWebhook}
      />

      {/* Modal Confirmação Revogação Token API */}
      <ConfirmModal
        open={revokingToken !== null}
        title="Revogar token de API"
        description={
          <span>
            Tem certeza que deseja revogar o token{' '}
            <strong className="text-ink">{revokingToken?.name}</strong> (
            <code className="font-mono text-dim">{revokingToken?.maskedValue}</code>)? Qualquer aplicação externa ou script utilizando esta chave perderá o acesso instantaneamente.
          </span>
        }
        confirmLabel="Revogar acesso"
        variant="danger"
        icon="warning"
        isLoading={isPending}
        onClose={() => setRevokingToken(null)}
        onConfirm={handleConfirmRevokeToken}
      />
    </div>
  );
}

