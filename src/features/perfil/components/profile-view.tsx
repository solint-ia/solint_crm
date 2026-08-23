'use client';

import { useState } from 'react';
import type { AvailabilityStatus, Session } from '@/core/domain/user';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/field';
import { Toggle } from '@/components/ui/toggle';
import { WhatsAppConnectionCard } from '@/features/whatsapp/components/whatsapp-connection-card';
import { WhatsAppModal } from '@/features/whatsapp/components/whatsapp-modal';
import { cn } from '@/lib/cn';
import { planned } from '@/components/ui/planned';

interface ProfileViewProps {
  readonly session: Session;
}

export function ProfileView({ session }: ProfileViewProps) {
  const { user, account, availableAccounts } = session;
  const [availability, setAvailability] = useState<AvailabilityStatus>(user.availability);
  const [isPairingOpen, setPairingOpen] = useState(false);
  const [notifications, setNotifications] = useState({
    assigned: true,
    mentions: true,
    sla: true,
    campaigns: false,
    dailySummary: false,
  });

  const toggleNotif = (key: keyof typeof notifications) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="grid max-w-5xl gap-5 md:grid-cols-2">
      <WhatsAppModal open={isPairingOpen} onClose={() => setPairingOpen(false)} />

      {/* DADOS PESSOAIS */}
      <Card className="flex flex-col gap-4 p-5">
        <h3 className="font-display text-title font-bold text-ink tracking-tight">
          Dados pessoais
        </h3>

        <div className="flex items-center gap-4">
          <Avatar
            name={user.name}
            tone={user.avatarTone}
            size="lg"
            availability={availability}
          />
          <Button variant="secondary" size="sm" {...planned('Enviar uma nova foto de perfil')}>
            Alterar foto
          </Button>
        </div>

        <Field label="Nome completo" htmlFor="profile-name">
          <TextInput id="profile-name" defaultValue={user.name} />
        </Field>

        <Field label="Email institucional" htmlFor="profile-email">
          <TextInput id="profile-email" type="email" defaultValue={user.email} />
        </Field>

        <Field label="Telefone de contato" htmlFor="profile-phone">
          <TextInput
            id="profile-phone"
            defaultValue="+55 11 99000-1234"
            className="font-mono text-body tabular-nums"
          />
        </Field>
      </Card>

      {/* CANAL DE ATENDIMENTO VINCULADO */}
      <div className="flex flex-col gap-5">
        <WhatsAppConnectionCard user={user} onOpenPairing={() => setPairingOpen(true)} />

        <Card className="p-5">
          <h3 className="mb-3 font-display text-title font-bold text-ink tracking-tight">
            Disponibilidade de atendimento
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'disponivel', label: 'Disponível', dot: 'bg-green-text' },
              { id: 'ocupado', label: 'Ocupado', dot: 'bg-red-text' },
              { id: 'ausente', label: 'Ausente', dot: 'bg-amber-text' },
            ].map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setAvailability(st.id as AvailabilityStatus)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-control border py-2 text-body font-semibold transition-all duration-150',
                  availability === st.id
                    ? 'border-brand bg-selected text-ink shadow-2xs'
                    : 'border-line text-muted hover:bg-surface-2',
                )}
              >
                <span className={cn('size-2 rounded-full', st.dot)} />
                {st.label}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-2 font-display text-title font-bold text-ink tracking-tight">
            Assinatura de mensagem
          </h3>
          <textarea
            rows={2}
            defaultValue={user.signature ?? `${user.name} · Comercial Solint`}
            className="w-full rounded-control border border-line bg-surface p-2.5 text-body text-ink outline-none"
          />
        </Card>

        <Card className="flex items-center justify-between gap-4 p-5">
          <div>
            <h3 className="font-display text-title font-bold text-ink tracking-tight">
              Senha de acesso
            </h3>
            <p className="mt-0.5 text-meta text-muted">
              Última alteração realizada há 3 meses
            </p>
          </div>
          <Button variant="secondary" size="sm" {...planned('Alterar a senha de acesso')}>
            Alterar senha
          </Button>
        </Card>
      </div>

      {/* NOTIFICAÇÕES E PREFERÊNCIAS */}
      <Card className="flex flex-col gap-4 p-5">
        <h3 className="font-display text-title font-bold text-ink tracking-tight">
          Notificações pessoais
        </h3>

        <div className="divide-y divide-line-soft">
          {[
            { key: 'assigned', label: 'Conversa atribuída diretamente a mim' },
            { key: 'mentions', label: 'Menções com @ em notas internas' },
            { key: 'sla', label: 'Alerta de SLA prestes a estourar' },
            { key: 'campaigns', label: 'Notificar conclusão de campanhas em massa' },
            { key: 'dailySummary', label: 'Receber resumo diário de atividades por email' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-body text-ink">{item.label}</span>
              <Toggle
                checked={notifications[item.key as keyof typeof notifications]}
                onChange={() => toggleNotif(item.key as keyof typeof notifications)}
                label={item.label}
              />
            </div>
          ))}
        </div>

        <div className="border-t border-line-soft pt-4 grid grid-cols-2 gap-3">
          <Field label="Idioma da interface">
            <TextInput defaultValue="Português (Brasil)" readOnly />
          </Field>
          <Field label="Fuso horário pessoal">
            <TextInput defaultValue="GMT-3 · São Paulo" readOnly />
          </Field>
        </div>
      </Card>

      {/* WORKSPACES / CONTAS VINCULADAS */}
      <Card className="flex flex-col gap-4 p-5">
        <h3 className="font-display text-title font-bold text-ink tracking-tight">
          Workspaces vinculados
        </h3>
        <p className="text-body text-muted">
          Você pode alternar entre contas a qualquer momento.
        </p>

        <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
          <div className="divide-y divide-line-soft">
            {availableAccounts.map((acc) => {
              const isCurrent = acc.id === account.id;
              return (
                <div
                  key={acc.id}
                  className={cn(
                    'flex items-center justify-between gap-3 p-3.5 transition-colors',
                    isCurrent ? 'bg-selected border-l-3 border-l-brand pl-3' : 'hover:bg-surface-2/60',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8.5 items-center justify-center rounded-control bg-brand-gradient font-display text-body font-bold text-white shadow-xs">
                      {acc.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-ui font-bold text-ink tracking-tight">
                        {acc.name}
                      </div>
                      <div className="text-meta capitalize text-muted">Plano {acc.plan}</div>
                    </div>
                  </div>
                  {isCurrent ? (
                    <Badge tone="blue">Workspace ativo</Badge>
                  ) : (
                    <Button variant="secondary" size="sm" {...planned('Trocar para este workspace')}>
                      Alternar
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
