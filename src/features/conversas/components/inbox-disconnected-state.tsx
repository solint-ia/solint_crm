'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  AlertCircle,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WhatsAppModal } from '@/features/whatsapp/components/whatsapp-modal';
import { useWhatsAppConnection } from '@/features/whatsapp/hooks/use-whatsapp-connection';

export function InboxDisconnectedState() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const {
    statusData,
    errorMessage,
    isPending,
    isAwaitingQR,
    isConnecting,
    connect,
  } = useWhatsAppConnection(true);

  const statusLabel = isConnecting
    ? 'Conectando ao WhatsApp...'
    : isAwaitingQR
      ? 'Aguardando Leitura do QR Code'
      : 'WhatsApp Desconectado';

  const statusTone = isConnecting ? 'blue' : isAwaitingQR ? 'amber' : 'red';

  return (
    <>
      <WhatsAppModal open={isModalOpen} onClose={() => setIsModalOpen(false)} />

      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-surface-2/60 p-6 sm:p-10 animate-in fade-in duration-200">
        <div className="w-full max-w-xl rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-xl">
          {/* Topo: Ícone + Status Badge */}
          <div className="flex flex-col items-center text-center">
            <div className="relative flex size-16 items-center justify-center rounded-2xl bg-red-soft/80 border border-red-line/40 text-red-text shadow-sm">
              <Unplug className="size-8 stroke-[2.2]" />
              <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-surface border-2 border-surface text-amber-500">
                <WifiOff className="size-3" />
              </span>
            </div>

            <div className="mt-4 flex items-center justify-center gap-2">
              <Badge tone={statusTone} withDot>
                {statusLabel}
              </Badge>
            </div>

            <h2 className="mt-3 font-display text-metric font-bold text-ink tracking-tight">
              Caixa de Entrada Desconectada
            </h2>

            <p className="mt-2 max-w-md text-body text-muted leading-relaxed">
              A instância do WhatsApp vinculada a esta caixa de entrada não está conectada.
              Para proteger a integridade do atendimento e visualizar ou responder mensagens,
              conecte seu número de WhatsApp.
            </p>
          </div>

          {/* Mensagem de Erro (se houver) */}
          {errorMessage && !isConnecting && !isAwaitingQR && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-red-soft p-3 text-meta text-red-text border border-red-line/50">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}


          {/* QR Code Integrado (se estiver aguardando leitura) */}
          {isAwaitingQR && statusData.qr ? (
            <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-line-soft bg-surface-2 p-5 animate-in zoom-in-95 duration-150">
              <div className="relative overflow-hidden rounded-lg bg-white p-3 shadow-md">
                <Image
                  src={statusData.qr}
                  alt="QR Code WhatsApp"
                  width={200}
                  height={200}
                  unoptimized
                  className="size-48 object-contain"
                />
              </div>
              <p className="mt-3 text-meta font-medium text-ink flex items-center gap-1.5">
                <Smartphone className="size-3.5 text-brand" />
                <span>Aponte a câmera do WhatsApp para este QR Code</span>
              </p>
            </div>
          ) : isConnecting ? (
            <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-line-soft bg-surface-2 p-8 text-center animate-in fade-in duration-150">
              <Loader2 className="size-8 animate-spin text-brand" />
              <p className="mt-2 text-body font-semibold text-ink">Iniciando sessão do WhatsApp...</p>
              <p className="mt-0.5 text-meta text-muted">Aguardando geração do QR Code de pareamento.</p>
            </div>
          ) : null}


          {/* Passos de Instrução */}
          <div className="mt-6 rounded-xl border border-line-soft bg-surface-2/40 p-4">
            <h4 className="text-meta font-bold uppercase tracking-wider text-dim">
              Como restabelecer o atendimento:
            </h4>
            <ol className="mt-3 flex flex-col gap-2.5 text-body text-ink">
              <li className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-micro font-bold text-brand mt-0.5">
                  1
                </span>
                <span>
                  Abra o <strong>WhatsApp</strong> no seu smartphone.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-micro font-bold text-brand mt-0.5">
                  2
                </span>
                <span>
                  Toque em <strong>Configurações</strong> (ou no menu de 3 pontos) e selecione{' '}
                  <strong>Aparelhos conectados</strong>.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-micro font-bold text-brand mt-0.5">
                  3
                </span>
                <span>
                  Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para escanear o QR Code.
                </span>
              </li>
            </ol>
          </div>

          {/* Ações */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-line-soft pt-5">
            <Button
              variant="primary"
              size="lg"
              icon={
                isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <QrCode className="size-4" />
                )
              }
              disabled={isPending}
              onClick={() => {
                if (!isAwaitingQR && !isConnecting) {
                  connect();
                }
                setIsModalOpen(true);
              }}
              className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow-md shadow-emerald-600/20"
            >
              {isConnecting
                ? 'Conectando...'
                : isAwaitingQR
                  ? 'Ver QR Code ampliado'
                  : 'Conectar WhatsApp'}
            </Button>

            {!isConnecting && !isAwaitingQR && (
              <Button
                variant="secondary"
                size="lg"
                icon={<RefreshCw className="size-4" />}
                onClick={connect}
                disabled={isPending}
              >
                Tentar reconectar
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
