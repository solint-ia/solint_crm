'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Phone,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
  Wifi,
} from 'lucide-react';
import { PhoneNumber } from '@/core/domain/contact';
import { Modal } from '@/components/ui/modal';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, TextInput } from '@/components/ui/field';
import { useWhatsAppConnection } from '../hooks/use-whatsapp-connection';

interface WhatsAppModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly inboxId?: string;
  readonly inboxName?: string;
}

type PairingMethod = 'qr' | 'phone';

const displayPairingCode = (code: string | undefined): string => {
  const clean = code?.replace(/[^A-Z0-9]/gi, '').toUpperCase() ?? '';
  return clean.match(/.{1,4}/g)?.join('-') ?? clean;
};

export function WhatsAppModal({ open, onClose, inboxId, inboxName }: WhatsAppModalProps) {
  const [pairingMethod, setPairingMethod] = useState<PairingMethod>('qr');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState<string>();
  const {
    statusData,
    errorMessage,
    isPending,
    isConnected,
    isAwaitingQR,
    isAwaitingPairingCode,
    isConnecting,
    connect,
    disconnect,
  } = useWhatsAppConnection(open, inboxId);

  const handleClose = () => {
    if (!isConnected && statusData.status !== 'desconectado') {
      void disconnect();
    }
    setPhoneError(undefined);
    onClose();
  };

  const chooseMethod = (method: PairingMethod) => {
    setPairingMethod(method);
    setPhoneError(undefined);
  };

  const handleConnect = () => {
    if (pairingMethod === 'phone') {
      if (!PhoneNumber.isValid(phoneNumber)) {
        setPhoneError('Informe o número com DDI e DDD, por exemplo: 5511999998888.');
        return;
      }
      setPhoneError(undefined);
      void connect({ method: 'phone', phoneNumber });
      return;
    }

    setPhoneError(undefined);
    void connect({ method: 'qr' });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={inboxName ? `Conectar WhatsApp · ${inboxName}` : 'Conectar WhatsApp Direto'}
      description="Escolha entre escanear um QR Code ou usar o código de pareamento pelo número de telefone."
      className="max-w-md"
    >
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Badge tone="green" withDot>
              WhatsApp Conectado
            </Badge>
          ) : isAwaitingPairingCode ? (
            <Badge tone="amber" withDot>
              Aguardando Pareamento
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

        {(phoneError || errorMessage) && !isConnecting && !isConnected ? (
          <p className="w-full rounded-control border border-red-line bg-red-soft px-3 py-2 text-center text-body text-red-text">
            {phoneError ?? errorMessage}
          </p>
        ) : null}

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

        {!isConnected && isAwaitingPairingCode && statusData.pairingCode ? (
          <div className="flex w-full flex-col items-center gap-4 text-center">
            <div className="flex w-full flex-col items-center rounded-float border-2 border-brand/30 bg-surface px-5 py-6 shadow-md">
              <KeyRound className="mb-3 size-7 text-brand" />
              <p className="text-meta font-semibold uppercase tracking-wide text-muted">
                Código de pareamento
              </p>
              <p
                className="mt-2 font-mono text-3xl font-bold tracking-[0.18em] text-ink"
                aria-live="polite"
              >
                {displayPairingCode(statusData.pairingCode)}
              </p>
            </div>

            <div className="w-full space-y-1.5 text-left text-body text-muted">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <Smartphone className="size-4 text-brand" /> Como conectar:
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-meta leading-relaxed">
                <li>Abra o WhatsApp no celular</li>
                <li>Acesse Aparelhos conectados e toque em Conectar aparelho</li>
                <li>Escolha Conectar com número de telefone</li>
                <li>Digite o código exibido acima</li>
              </ol>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => void disconnect()}
              disabled={isPending}
              icon={<Unplug className="size-3.5" />}
            >
              {isPending ? 'Cancelando...' : 'Cancelar pareamento'}
            </Button>
          </div>
        ) : null}

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
                <li>Toque em Mais opções (Android) ou Configurações (iOS)</li>
                <li>Selecione Aparelhos conectados e Conectar um aparelho</li>
                <li>Aponte a câmera para este QR Code</li>
              </ol>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleConnect}
              disabled={isPending}
              icon={<RefreshCw className="size-3.5" />}
            >
              {isPending ? 'Recarregando...' : 'Gerar novo QR Code'}
            </Button>
          </div>
        ) : null}

        {!isConnected && isConnecting ? (
          <div className="flex size-60 flex-col items-center justify-center gap-3 rounded-float border border-line bg-surface-2 p-6 text-center">
            <Loader2 className="size-8 animate-spin text-brand" />
            <p className="text-body font-semibold text-ink">Iniciando sessão do WhatsApp...</p>
            <p className="text-meta text-muted">
              {pairingMethod === 'phone'
                ? 'Solicitando o código de pareamento para este número.'
                : 'Gerando chaves criptográficas e o QR Code de pareamento.'}
            </p>
          </div>
        ) : null}

        {!isConnected && !isAwaitingQR && !isAwaitingPairingCode && !isConnecting ? (
          <div className="flex w-full flex-col gap-4 rounded-surface border border-line bg-surface-2 p-5">
            <div className="text-center">
              <h3 className="font-display text-ui font-semibold text-ink">Como deseja conectar?</h3>
              <p className="mt-1 text-body text-muted">
                Os dois métodos usam a mesma sessão segura do WhatsApp.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Método de conexão">
              <button
                type="button"
                onClick={() => chooseMethod('qr')}
                aria-pressed={pairingMethod === 'qr'}
                className={`flex flex-col items-center gap-2 rounded-control border px-3 py-3 text-meta font-semibold transition-colors ${
                  pairingMethod === 'qr'
                    ? 'border-brand bg-accent-soft text-brand'
                    : 'border-line bg-surface text-muted hover:border-brand/50'
                }`}
              >
                <QrCode className="size-5" />
                Usar QR Code
              </button>
              <button
                type="button"
                onClick={() => chooseMethod('phone')}
                aria-pressed={pairingMethod === 'phone'}
                className={`flex flex-col items-center gap-2 rounded-control border px-3 py-3 text-meta font-semibold transition-colors ${
                  pairingMethod === 'phone'
                    ? 'border-brand bg-accent-soft text-brand'
                    : 'border-line bg-surface text-muted hover:border-brand/50'
                }`}
              >
                <Phone className="size-5" />
                Usar telefone
              </button>
            </div>

            {pairingMethod === 'phone' ? (
              <Field
                label="Número do WhatsApp"
                htmlFor="whatsapp-pairing-phone"
                hint="Inclua o DDI e o DDD. Exemplo: 5511999998888."
                error={phoneError}
              >
                <TextInput
                  id="whatsapp-pairing-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="5511999998888"
                  value={phoneNumber}
                  onChange={(event) => {
                    setPhoneNumber(event.target.value);
                    if (phoneError) setPhoneError(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleConnect();
                  }}
                />
              </Field>
            ) : null}

            <Button
              variant="primary"
              size="md"
              onClick={handleConnect}
              disabled={isPending}
              icon={
                pairingMethod === 'phone' ? (
                  <KeyRound className="size-4" />
                ) : (
                  <Wifi className="size-4" />
                )
              }
            >
              {isPending
                ? 'Iniciando...'
                : pairingMethod === 'phone'
                  ? 'Gerar código de pareamento'
                  : 'Gerar QR Code de conexão'}
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
