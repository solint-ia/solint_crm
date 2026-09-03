'use client';

import { CheckCircle2, Loader2, Phone, QrCode, Unplug, Wifi } from 'lucide-react';
import type { User } from '@/core/domain/user';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useWhatsAppConnection } from '../hooks/use-whatsapp-connection';
import { useDatasDaConta } from '@/components/layout/regional-provider';

interface WhatsAppConnectionCardProps {
  readonly user: User;
  /**
   * Caixa a que este cartão pertence.
   *
   * Sem ela o cartão fala da rota global, que resolve **uma** caixa no servidor
   * (`findFirst`) e ignora as demais — era por isso que uma conta com três
   * números via um só no perfil, sempre o mesmo, sem nada que explicasse o
   * sumiço dos outros dois. Com o id, cada cartão assina o fluxo da sua caixa.
   */
  readonly inboxId?: string;
  readonly inboxName?: string;
  /** Abre a tela onde o QR Code e exibido (Configurações › Integrações). */
  readonly onOpenPairing?: () => void;
}

const formatDateTime = (iso: string | undefined, dataHora: (date: Date) => string): string =>
  iso ? dataHora(new Date(iso)) : '—';

/**
 * Vinculo entre o perfil do usuário do CRM e o número de WhatsApp pareado.
 * Deixa explicito *qual conta* esta atendendo em nome deste perfil — sem isso
 * o agente não tem como saber por qual número suas respostas estao saindo.
 */
export function WhatsAppConnectionCard({
  user,
  inboxId,
  inboxName,
  onOpenPairing,
}: WhatsAppConnectionCardProps) {
  const { statusData, errorMessage, isPending, isConnected, isConnecting, connect, disconnect } =
    useWhatsAppConnection(true, inboxId);
  const { dataHora } = useDatasDaConta();

  const ownedByOther = Boolean(statusData.owner && statusData.owner.userId !== user.id);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-title font-bold text-ink tracking-tight">
            {inboxName ?? 'WhatsApp vinculado ao perfil'}
          </h3>
          <p className="text-body text-muted">
            {inboxName
              ? 'Número desta caixa de entrada.'
              : 'Número usado para enviar e receber suas conversas no CRM.'}
          </p>
        </div>
        {isConnected ? (
          <Badge tone="green" withDot>
            Conectado
          </Badge>
        ) : isConnecting ? (
          <Badge tone="blue" withDot>
            Conectando
          </Badge>
        ) : (
          <Badge tone="slate" withDot>
            Desconectado
          </Badge>
        )}
      </div>

      {errorMessage ? (
        <p className="rounded-control border border-red-line bg-red-soft px-3 py-2 text-body text-red-text">
          {errorMessage}
        </p>
      ) : null}

      {isConnected ? (
        <>
          <div className="flex items-center gap-3.5 rounded-surface border border-green-border/40 bg-green-soft/30 p-3.5">
            <Avatar
              name={statusData.name ?? 'WhatsApp'}
              src={statusData.avatarUrl}
              tone="var(--color-whatsapp)"
              size="lg"
            />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-display text-ui font-bold text-ink">
                <CheckCircle2 className="size-4 text-green-text" />
                {statusData.name ?? 'Instância ativa'}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-body font-semibold text-green-text">
                <Phone className="size-3.5" />
                {statusData.phone ?? 'Número conectado'}
              </p>
              <p className="mt-1 text-meta text-muted">
                Pareado por {statusData.owner?.userName ?? user.name} ·{' '}
                {formatDateTime(statusData.connectedAt, dataHora)}
              </p>
            </div>
          </div>

          {ownedByOther ? (
            <p className="rounded-control border border-note-line bg-note px-3 py-2 text-meta text-note-text">
              Este número foi pareado por {statusData.owner?.userName}. Desconectar afeta o
              atendimento de toda a equipe.
            </p>
          ) : null}

          <Button
            variant="danger"
            size="sm"
            onClick={disconnect}
            disabled={isPending}
            icon={<Unplug className="size-3.5" />}
            className="self-start"
          >
            {isPending ? 'Desconectando...' : 'Desconectar número'}
          </Button>
        </>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-surface border border-line bg-surface-2 p-4">
          <span className="flex size-10 items-center justify-center rounded-surface bg-accent-soft text-brand">
            {isConnecting ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <QrCode className="size-5" />
            )}
          </span>
          <p className="text-body text-muted">
            {isConnecting
              ? 'Gerando o QR Code de pareamento...'
              : inboxName
                ? 'Esta caixa ainda não tem número pareado. Conecte para começar a atender por ela.'
                : 'Nenhum número vinculado a este perfil. Conecte para atender pelo seu WhatsApp.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={connect}
              disabled={isPending || isConnecting}
              icon={<Wifi className="size-3.5" />}
            >
              {isPending ? 'Iniciando...' : inboxName ? 'Conectar número' : 'Conectar meu WhatsApp'}
            </Button>
            {onOpenPairing ? (
              <Button variant="secondary" size="sm" onClick={onOpenPairing}>
                Ver QR Code
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}
