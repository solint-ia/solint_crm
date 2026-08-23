'use client';

import { Ban, Merge, MessageSquarePlus, Users } from 'lucide-react';
import type { Conversation } from '@/core/domain/conversation';
import { isGroupContact, PhoneNumber } from '@/core/domain/contact';
import type { Label } from '@/core/domain/label';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { LabelChips } from '@/components/domain/label-chip';
import { planned } from '@/components/ui/planned';
import { LabelMenu } from './conversation-toolbar';

interface ContextPanelProps {
  readonly conversation: Conversation;
  readonly labels: readonly Label[];
  readonly onSetConversationLabels: (labels: readonly Label[]) => void;
  readonly onSetContactLabels: (labels: readonly Label[]) => void;
}

/** Coluna 4: contexto do contato (SKILL.md secao 4.4). */
export function ContextPanel({
  conversation,
  labels,
  onSetConversationLabels,
  onSetContactLabels,
}: ContextPanelProps) {
  const { contact } = conversation;
  const isGroup = isGroupContact(contact);

  return (
    <aside className="flex w-full flex-col overflow-y-auto border-l border-line bg-surface xl:w-[320px] xl:shrink-0">
      <div className="flex flex-col items-center gap-2 border-b border-line px-4 py-5 text-center">
        <Avatar name={contact.name} tone={contact.avatarTone} src={contact.avatarUrl} size="lg" />
        <p className="font-display text-ui font-semibold text-ink">{contact.name}</p>

        {isGroup ? (
          <>
            <p className="flex items-center gap-1.5 text-body text-muted">
              <Users className="size-3.5" />
              Grupo do WhatsApp
              {contact.participantCount ? ` · ${contact.participantCount} participantes` : ''}
            </p>
            <p className="text-meta text-dim">
              Mensagens deste grupo são respondidas para todos os participantes.
            </p>
          </>
        ) : (
          <>
            <p className="text-body text-muted">{contact.company ?? 'Sem empresa vinculada'}</p>
            <p className="font-mono text-meta text-muted">
              {PhoneNumber.format(contact.phone) || 'Sem telefone'}
            </p>
            {contact.email ? <p className="text-meta text-muted">{contact.email}</p> : null}
            <p className="text-meta text-dim">
              {contact.location} · {contact.timezone}
            </p>
          </>
        )}
      </div>

      {/* Duas listas de propósito: a da conversa descreve o atendimento, a do
          contato descreve a pessoa e vale para todos os atendimentos dela. */}
      <Section
        title="Etiquetas da conversa"
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
          <p className="text-meta text-dim">Nenhuma etiqueta neste atendimento.</p>
        )}
      </Section>

      <Section
        title="Etiquetas do contato"
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
          <p className="text-meta text-dim">Nenhuma etiqueta neste contato.</p>
        )}
      </Section>

      <Section title="Campos personalizados">
        {contact.customFields.length === 0 ? (
          <p className="text-meta text-dim">Nenhum campo preenchido.</p>
        ) : null}
        <dl className="flex flex-col gap-1.5">
          {contact.customFields.map((field) => (
            <div key={field.label} className="flex items-center justify-between gap-2">
              <dt className="text-meta text-muted">{field.label}</dt>
              <dd className="font-mono text-meta text-ink">{field.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Histórico de protocolos">
        {conversation.protocols.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {conversation.protocols.map((protocol) => (
              <li key={protocol.code} className="flex items-center justify-between gap-2">
                <span>
                  <span className="block font-mono text-meta text-ink">{protocol.code}</span>
                  <span className="block text-meta text-dim">{protocol.date}</span>
                </span>
                <Badge tone={protocol.status === 'Pendente' ? 'amber' : 'slate'}>
                  {protocol.status}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-dim">Primeiro atendimento deste contato.</p>
        )}
      </Section>

      <Section title="Ações rápidas">
        <div className="flex flex-col gap-1.5">
          <QuickAction
            icon={<MessageSquarePlus className="size-3.5" />}
            hint="Abrir uma nova conversa com este contato"
          >
            Iniciar nova conversa
          </QuickAction>
          {isGroup ? null : (
            <>
              <QuickAction
                icon={<Merge className="size-3.5" />}
                hint="Unir contatos duplicados preservando o histórico"
              >
                Mesclar duplicados
              </QuickAction>
              <QuickAction
                icon={<Ban className="size-3.5" />}
                hint="Impedir novas mensagens deste contato"
              >
                Bloquear contato
              </QuickAction>
            </>
          )}
        </div>
      </Section>
    </aside>
  );
}

function Section({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-4 py-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-meta font-semibold tracking-wide text-dim uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function QuickAction({
  icon,
  hint,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      {...(hint ? planned(hint) : {})}
      className="flex items-center gap-2 rounded-control border border-line px-2.5 py-2 text-left text-meta font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="text-dim">{icon}</span>
      {children}
    </button>
  );
}
