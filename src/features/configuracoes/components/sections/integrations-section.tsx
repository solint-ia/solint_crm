'use client';

import { useState } from 'react';
import { Plus, QrCode } from 'lucide-react';
import type { ApiToken, ChannelConnection, Webhook } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  CONNECTION_STATUS_LABEL,
  CONNECTION_STATUS_TONE,
} from '@/components/domain/presentation-maps';
import { WhatsAppModal } from '@/features/whatsapp/components/whatsapp-modal';
import { planned } from '@/components/ui/planned';

interface IntegrationsSectionProps {
  readonly connections: readonly ChannelConnection[];
  readonly webhooks: readonly Webhook[];
  readonly apiTokens: readonly ApiToken[];
}

export function IntegrationsSection({
  connections,
  webhooks,
  apiTokens,
}: IntegrationsSectionProps) {
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <WhatsAppModal
        open={isWhatsAppModalOpen}
        onClose={() => setIsWhatsAppModalOpen(false)}
      />

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
          <Button variant="secondary" size="sm" icon={<Plus className="size-3.5" />} {...planned('Cadastrar um webhook de saída')}>
            Novo webhook
          </Button>
        </div>

        <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
          <div className="divide-y divide-line-soft">
            {webhooks.map((wh) => (
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
                  <Badge tone={wh.enabled ? 'green' : 'slate'}>
                    {wh.enabled ? 'Ativo' : 'Pausado'}
                  </Badge>
                </div>
              </div>
            ))}
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
          <Button variant="secondary" size="sm" icon={<Plus className="size-3.5" />} {...planned('Gerar um token de API')}>
            Gerar token
          </Button>
        </div>

        <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
          <div className="divide-y divide-line-soft">
            {apiTokens.map((token) => (
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
                <Button variant="danger" size="sm" {...planned('Revogar este token de API')}>
                  Revogar
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
