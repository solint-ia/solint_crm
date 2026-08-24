'use client';

import { useState } from 'react';
import {
  Ban,
  Building,
  Copy,
  Mail,
  MapPin,
  Merge,
  MessageSquarePlus,
  Phone,
  Tag,
  Users,
  X,
  Check,
} from 'lucide-react';
import type { Conversation } from '@/core/domain/conversation';
import { isGroupContact, PhoneNumber } from '@/core/domain/contact';
import type { Label } from '@/core/domain/label';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { LabelChips } from '@/components/domain/label-chip';
import { planned } from '@/components/ui/planned';
import { LabelMenu } from './conversation-toolbar';
import { cn } from '@/lib/cn';

interface ContextPanelProps {
  readonly conversation: Conversation;
  readonly labels: readonly Label[];
  readonly onSetConversationLabels: (labels: readonly Label[]) => void;
  readonly onSetContactLabels: (labels: readonly Label[]) => void;
  readonly onClose?: () => void;
}

export function ContextPanel({
  conversation,
  labels,
  onSetConversationLabels,
  onSetContactLabels,
  onClose,
}: ContextPanelProps) {
  const { contact } = conversation;
  const isGroup = isGroupContact(contact);
  const [copied, setCopied] = useState(false);

  const copyPhone = () => {
    if (!contact.phone) return;
    navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-white/[0.06] bg-[#0c1220] xl:w-[330px] xl:shrink-0 text-slate-200 select-none">
      {/* Topo / Cabeçalho do Painel com botão de fechar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 bg-[#0e1626]">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Tag className="size-3.5 text-blue-400" />
          <span>Detalhes do Contato</span>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel de detalhes"
            title="Fechar detalhes"
            className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Cartão de Perfil do Contato */}
      <div className="flex flex-col items-center gap-3 border-b border-white/[0.06] px-5 py-6 text-center bg-white/[0.01]">
        <Avatar name={contact.name} tone={contact.avatarTone} src={contact.avatarUrl} size="lg" />

        <div className="w-full min-w-0">
          <h3 className="truncate font-display text-sm font-bold text-slate-100">
            {contact.name}
          </h3>

          {isGroup ? (
            <div className="mt-1 flex flex-col items-center gap-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs text-slate-300">
                <Users className="size-3 text-cyan-400" />
                Grupo do WhatsApp
                {contact.participantCount ? ` · ${contact.participantCount} membros` : ''}
              </span>
              <p className="text-[11px] text-slate-400 mt-1">
                Respostas enviadas são distribuídas a todos os participantes.
              </p>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5 text-left text-xs">
              {contact.company && (
                <div className="flex items-center gap-2 text-slate-300">
                  <Building className="size-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{contact.company}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 text-slate-300">
                <div className="flex items-center gap-2 min-w-0">
                  <Phone className="size-3.5 shrink-0 text-slate-400" />
                  <span className="truncate font-mono text-[11px]">
                    {PhoneNumber.format(contact.phone) || 'Sem telefone'}
                  </span>
                </div>
                {contact.phone && (
                  <button
                    type="button"
                    onClick={copyPhone}
                    title="Copiar telefone"
                    className="flex size-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-white/[0.08] hover:text-white"
                  >
                    {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  </button>
                )}
              </div>

              {contact.email && (
                <div className="flex items-center gap-2 text-slate-300">
                  <Mail className="size-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{contact.email}</span>
                </div>
              )}

              {(contact.location || contact.timezone) && (
                <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                  <MapPin className="size-3.5 shrink-0 text-slate-400" />
                  <span>{[contact.location, contact.timezone].filter(Boolean).join(' · ')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Seções em cartões organizados */}
      <div className="flex flex-col p-3 gap-3">
        {/* Seção 1: Etiquetas da Conversa */}
        <CardSection
          title="Etiquetas do Atendimento"
          action={
            <LabelMenu
              conversation={conversation}
              labels={labels}
              onChange={onSetConversationLabels}
            />
          }
        >
          {conversation.labels.length > 0 ? (
            <LabelChips labels={conversation.labels} />
          ) : (
            <p className="text-xs text-slate-400">Nenhuma etiqueta neste atendimento.</p>
          )}
        </CardSection>

        {/* Seção 2: Etiquetas do Contato */}
        <CardSection
          title="Etiquetas do Contato"
          action={
            <LabelMenu
              conversation={{ ...conversation, labels: contact.labels }}
              labels={labels}
              onChange={onSetContactLabels}
            />
          }
        >
          {contact.labels.length > 0 ? (
            <LabelChips labels={contact.labels} />
          ) : (
            <p className="text-xs text-slate-400">Nenhuma etiqueta atribuída ao contato.</p>
          )}
        </CardSection>

        {/* Seção 3: Campos Personalizados */}
        <CardSection title="Campos Personalizados">
          {contact.customFields.length === 0 ? (
            <p className="text-xs text-slate-400">Nenhum campo personalizado.</p>
          ) : (
            <dl className="flex flex-col gap-2 text-xs">
              {contact.customFields.map((field) => (
                <div key={field.label} className="flex items-center justify-between gap-2 border-b border-white/[0.04] pb-1.5 last:border-0 last:pb-0">
                  <dt className="text-slate-400">{field.label}</dt>
                  <dd className="font-mono text-slate-200 font-medium">{field.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardSection>

        {/* Seção 4: Histórico de Protocolos */}
        <CardSection title="Histórico de Protocolos">
          {conversation.protocols.length > 0 ? (
            <ul className="flex flex-col gap-2 text-xs">
              {conversation.protocols.map((protocol) => (
                <li
                  key={protocol.code}
                  className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] border border-white/[0.04] p-2"
                >
                  <div>
                    <span className="block font-mono font-semibold text-slate-200">
                      {protocol.code}
                    </span>
                    <span className="block text-[10px] text-slate-400">{protocol.date}</span>
                  </div>
                  <Badge tone={protocol.status === 'Pendente' ? 'amber' : 'slate'}>
                    {protocol.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">Primeiro atendimento deste contato.</p>
          )}
        </CardSection>

        {/* Seção 5: Ações Rápidas */}
        <CardSection title="Ações Rápidas">
          <div className="flex flex-col gap-1.5">
            <QuickActionButton
              icon={<MessageSquarePlus className="size-3.5 text-blue-400" />}
              label="Iniciar nova conversa"
              {...planned('Abertura de nova conversa')}
            />
            {!isGroup && (
              <>
                <QuickActionButton
                  icon={<Merge className="size-3.5 text-sky-400" />}
                  label="Mesclar contatos duplicados"
                  {...planned('Mesclagem de contatos')}
                />
                <QuickActionButton
                  icon={<Ban className="size-3.5 text-red-400" />}
                  label="Bloquear contato"
                  tone="danger"
                  {...planned('Bloqueio de contato')}
                />
              </>
            )}
          </div>
        </CardSection>
      </div>
    </aside>
  );
}

function CardSection({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          {title}
        </h4>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

function QuickActionButton({
  icon,
  label,
  tone = 'default',
  onClick,
  title,
  disabled,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly tone?: 'default' | 'danger';
  readonly onClick?: () => void;
  readonly title?: string;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-xs font-medium transition-all text-left disabled:opacity-40 disabled:pointer-events-none',
        tone === 'danger'
          ? 'text-red-400 hover:bg-red-500/10 hover:border-red-500/20'
          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white hover:border-white/[0.08]',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
