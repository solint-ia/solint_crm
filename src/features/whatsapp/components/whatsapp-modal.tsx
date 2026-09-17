'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Phone,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unplug,
  Wifi,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { useWhatsAppConnection } from '../hooks/use-whatsapp-connection';
import { CloudApiConnectForm } from './cloud-api-connect-form';
import { CloudApiPanel } from './cloud-api-panel';

interface WhatsAppModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly inboxId?: string;
  readonly inboxName?: string;
}

/**
 * Duas formas de conectar um número.
 *
 * `qr` é o WhatsApp Web (Baileys), para quem não tem número oficial. `cloud` é a
 * API oficial da Meta, para número cadastrado lá. O pareamento por código de
 * telefone saiu quando a API oficial entrou no lugar dele.
 */
type ConnectionMethod = 'qr' | 'cloud';
type HistoryDays = 0 | 7 | 15 | 30 | 90;

export function WhatsAppModal({ open, onClose, inboxId, inboxName }: WhatsAppModalProps) {
  const [method, setMethod] = useState<ConnectionMethod>('qr');
  const [historyDays, setHistoryDays] = useState<HistoryDays>(0);
  const [verifyToken, setVerifyToken] = useState<string>();
  const {
    statusData,
    errorMessage,
    isPending,
    isConnected,
    isAwaitingQR,
    isConnecting,
    connect,
    disconnect,
    refresh,
  } = useWhatsAppConnection(open, inboxId);

  const isCloud = statusData.provider === 'cloud_api';

  const handleClose = () => {
    if (!isCloud && !isConnected && statusData.status !== 'desconectado') {
      void disconnect();
    }
    setVerifyToken(undefined);
    onClose();
  };

  const handleConnectQr = () => {
    void connect({ historyDays });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={inboxName ? `Conectar WhatsApp · ${inboxName}` : 'Conectar WhatsApp'}
      description="Conecte pelo QR Code (WhatsApp Web) ou pela API oficial da Meta, se o número for oficial."
      className="max-w-lg"
    >
      <div className="flex flex-col items-center gap-4 py-2">
        {isCloud && inboxId ? (
          <CloudApiPanel
            inboxId={inboxId}
            status={statusData}
            {...(verifyToken ? { verifyToken } : {})}
            onChanged={() => void refresh()}
          />
        ) : (
          <>
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

            {statusData.historyImport ? (
              <p className="w-full rounded-control border border-line bg-surface-2 px-3 py-2 text-center text-meta text-muted">
                {statusData.historyImport.status === 'importando' ||
                statusData.historyImport.status === 'aguardando'
                  ? `Importando histórico: ${Math.round(statusData.historyImport.progresso)}%`
                  : statusData.historyImport.status === 'concluida'
                    ? `Histórico importado: ${statusData.historyImport.mensagens.toLocaleString('pt-BR')} mensagens em ${statusData.historyImport.conversas.toLocaleString('pt-BR')} conversas`
                    : statusData.historyImport.status === 'numero_diferente'
                      ? 'Não importado: número diferente do anterior.'
                      : statusData.historyImport.status === 'nao_disponivel'
                        ? 'Histórico não disponível neste vínculo.'
                        : statusData.historyImport.status === 'parcial'
                          ? 'Importação parcial. Parte do histórico foi preservada.'
                          : 'Não foi possível importar o histórico.'}
              </p>
            ) : null}

            {errorMessage && !isConnecting && !isConnected && method === 'qr' ? (
              <p className="w-full rounded-control border border-red-line bg-red-soft px-3 py-2 text-center text-body text-red-text">
                {errorMessage}
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
                {inboxId ? (
                  <button
                    type="button"
                    className="text-meta font-semibold text-brand hover:underline"
                    onClick={() => setMethod('cloud')}
                  >
                    Migrar este número para a API oficial
                  </button>
                ) : null}
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
                  onClick={handleConnectQr}
                  disabled={isPending}
                  icon={<RefreshCw className="size-3.5" />}
                >
                  {isPending ? 'Recarregando...' : 'Gerar novo QR Code'}
                </Button>
              </div>
            ) : null}

            {!isConnected && isConnecting && method === 'qr' ? (
              <div className="flex size-60 flex-col items-center justify-center gap-3 rounded-float border border-line bg-surface-2 p-6 text-center">
                <Loader2 className="size-8 animate-spin text-brand" />
                <p className="text-body font-semibold text-ink">Iniciando sessão do WhatsApp...</p>
                <p className="text-meta text-muted">
                  Gerando chaves criptográficas e o QR Code de pareamento.
                </p>
              </div>
            ) : null}

            {(!isConnected && !isAwaitingQR && !isConnecting) || method === 'cloud' ? (
              <div className="flex w-full flex-col gap-4 rounded-surface border border-line bg-surface-2 p-5">
                <div className="text-center">
                  <h3 className="font-display text-ui font-semibold text-ink">
                    Como deseja conectar?
                  </h3>
                  <p className="mt-1 text-body text-muted">
                    Número oficial cadastrado na Meta usa a API oficial. Os demais, o QR Code.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Método de conexão">
                  <button
                    type="button"
                    onClick={() => setMethod('qr')}
                    aria-pressed={method === 'qr'}
                    className={`flex flex-col items-center gap-2 rounded-control border px-3 py-3 text-meta font-semibold transition-colors ${
                      method === 'qr'
                        ? 'border-brand bg-accent-soft text-brand'
                        : 'border-line bg-surface text-muted hover:border-brand/50'
                    }`}
                  >
                    <QrCode className="size-5" />
                    QR Code
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod('cloud')}
                    aria-pressed={method === 'cloud'}
                    disabled={!inboxId}
                    className={`flex flex-col items-center gap-2 rounded-control border px-3 py-3 text-meta font-semibold transition-colors disabled:opacity-50 ${
                      method === 'cloud'
                        ? 'border-brand bg-accent-soft text-brand'
                        : 'border-line bg-surface text-muted hover:border-brand/50'
                    }`}
                  >
                    <ShieldCheck className="size-5" />
                    API oficial da Meta
                  </button>
                </div>

                {method === 'cloud' && inboxId ? (
                  <>
                    {isConnected ? (
                      <p className="rounded-control border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-800 dark:text-amber-200">
                        Ao conectar a API oficial, o QR Code desta caixa é desconectado. As
                        conversas continuam; grupos deixam de ser atendidos.
                      </p>
                    ) : null}
                    <CloudApiConnectForm
                      inboxId={inboxId}
                      onConnected={(result) => {
                        if (result.verifyToken) setVerifyToken(result.verifyToken);
                        void refresh();
                      }}
                    />
                  </>
                ) : (
                  <>
                    {statusData.historyImportEnabled ? (
                      <Field
                        label="Importar histórico"
                        htmlFor="whatsapp-history-days"
                        hint={
                          statusData.paired
                            ? 'Esta caixa já está pareada. Para importar, desconecte e conecte de novo.'
                            : 'O celular decide quanto enviar, então o período pode vir incompleto. Mídias são baixadas quando alguém abrir.'
                        }
                      >
                        <select
                          id="whatsapp-history-days"
                          value={historyDays}
                          disabled={statusData.paired}
                          onChange={(event) =>
                            setHistoryDays(Number(event.target.value) as HistoryDays)
                          }
                          className="h-10 w-full rounded-control border border-line bg-surface px-3 text-body text-ink outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value={0}>Não importar</option>
                          <option value={7}>Últimos 7 dias</option>
                          <option value={15}>Últimos 15 dias</option>
                          <option value={30}>Últimos 30 dias</option>
                          <option value={90}>Últimos 90 dias, sincronização completa</option>
                        </select>
                      </Field>
                    ) : null}

                    {!isConnected ? (
                      <Button
                        variant="primary"
                        size="md"
                        onClick={handleConnectQr}
                        disabled={isPending}
                        icon={<Wifi className="size-4" />}
                      >
                        {isPending ? 'Iniciando...' : 'Gerar QR Code de conexão'}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
