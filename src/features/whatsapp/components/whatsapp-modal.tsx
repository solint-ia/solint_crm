'use client';

import {
  CheckCircle2,
  Loader2,
  Phone,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
  Wifi,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWhatsAppConnection } from '../hooks/use-whatsapp-connection';

interface WhatsAppModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function WhatsAppModal({ open, onClose }: WhatsAppModalProps) {
  // O stream so fica aberto enquanto o modal esta visível.
  const {
    statusData,
    errorMessage,
    isPending,
    isConnected,
    isAwaitingQR,
    isConnecting,
    connect,
    disconnect,
  } = useWhatsAppConnection(open);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Conectar WhatsApp Direto"
      description="Conecte seu número escaneando o QR Code para receber e responder conversas em tempo real."
      className="max-w-md"
    >
      <div className="flex flex-col items-center gap-4 py-2">
        {/* Status Badge */}
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Badge tone="green" withDot>
              WhatsApp Conectado
            </Badge>
          ) : isAwaitingQR ? (
            <Badge tone="amber" withDot>
              Aguardando Leitura
            </Badge>
          ) : isConnecting ? (
            <Badge tone="blue" withDot>
              Inicializando Conexão...
            </Badge>
          ) : (
            <Badge tone="slate" withDot>
              Desconectado
            </Badge>
          )}
        </div>

        {errorMessage && !isConnecting && !isAwaitingQR && !isConnected ? (
          <p className="w-full rounded-control border border-red-line bg-red-soft px-3 py-2 text-center text-body text-red-text">
            {errorMessage}
          </p>
        ) : null}


        {/* Cenário 1: Conectado com sucesso */}
        {isConnected ? (
          <div className="flex w-full flex-col items-center gap-4 rounded-surface border border-green-border/40 bg-green-soft/30 p-6 text-center">
            {statusData.avatarUrl ? (
              <Avatar
                name={statusData.name ?? 'WhatsApp'}
                src={statusData.avatarUrl}
                tone="var(--color-whatsapp)"
                size="lg"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-full bg-whatsapp text-white shadow-md">
                <CheckCircle2 className="size-8" />
              </div>
            )}

            <div>
              <h3 className="font-display text-title font-semibold text-ink">
                Instância Ativa &amp; Online
              </h3>
              <p className="mt-1 flex items-center justify-center gap-1.5 font-mono text-ui font-bold text-green-text">
                <Phone className="size-4" />
                {statusData.phone || 'Número Conectado'}
              </p>
              <p className="mt-1 text-body text-muted">
                {statusData.name || 'Solint CRM'} · Mensagens sincronizadas em tempo real
              </p>
              {statusData.owner ? (
                <p className="mt-1 text-meta text-dim">
                  Vinculado ao perfil de {statusData.owner.userName}
                </p>
              ) : null}
            </div>

            <Button
              variant="danger"
              size="sm"
              onClick={disconnect}
              disabled={isPending}
              icon={<Unplug className="size-3.5" />}
              className="mt-2"
            >
              {isPending ? 'Desconectando...' : 'Desconectar este WhatsApp'}
            </Button>
          </div>
        ) : null}

        {/* Cenário 2: Exibição do QR Code */}
        {!isConnected && isAwaitingQR && statusData.qr ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="relative rounded-float border-2 border-brand/30 bg-white p-3 shadow-md transition-transform hover:scale-[1.01]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={statusData.qr}
                alt="QR Code WhatsApp"
                className="size-60 rounded-control object-contain"
              />
            </div>

            <div className="space-y-1.5 text-left text-body text-muted">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <Smartphone className="size-4 text-brand" /> Como conectar:
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-meta leading-relaxed">
                <li>Abra o WhatsApp no seu smartphone</li>
                <li>
                  Toque em <b>Mais opções</b> (Android) ou <b>Configurações</b> (iOS)
                </li>
                <li>
                  Selecione <b>Aparelhos conectados</b> &gt; <b>Conectar um aparelho</b>
                </li>
                <li>Aponte a câmera para este QR Code</li>
              </ol>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={connect}
              disabled={isPending}
              icon={<RefreshCw className="size-3.5" />}
            >
              {isPending ? 'Recarregando...' : 'Gerar novo código'}
            </Button>
          </div>
        ) : null}

        {/* Cenário 3: Inicializando / Gerando QR */}
        {!isConnected && isConnecting ? (
          <div className="flex size-60 flex-col items-center justify-center gap-3 rounded-float border border-line bg-surface-2 p-6 text-center">
            <Loader2 className="size-8 animate-spin text-brand" />
            <p className="text-body font-semibold text-ink">Iniciando sessão do WhatsApp...</p>
            <p className="text-meta text-muted">
              Gerando chaves criptográficas e QR Code de pareamento.
            </p>
          </div>
        ) : null}

        {/* Cenário 4: Desconectado / Iniciar */}
        {!isConnected && !isAwaitingQR && !isConnecting ? (
          <div className="flex w-full flex-col items-center gap-4 rounded-surface border border-line bg-surface-2 p-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-surface bg-accent-soft text-brand">
              <QrCode className="size-6" />

            </div>

            <div>
              <h3 className="font-display text-ui font-semibold text-ink">
                Nenhum WhatsApp conectado
              </h3>
              <p className="mt-1 text-body text-muted">
                Clique no botão abaixo para gerar um QR Code e conectar seu WhatsApp diretamente ao
                Solint CRM.
              </p>
            </div>

            <Button
              variant="primary"
              size="md"
              onClick={connect}
              disabled={isPending}
              icon={<Wifi className="size-4" />}
            >
              {isPending ? 'Iniciando...' : 'Gerar QR Code de Conexão'}
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
