'use client';

import { Users } from 'lucide-react';
import type { Conversation } from '@/core/domain/conversation';
import { isGroupContact } from '@/core/domain/contact';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChannelDot } from '@/components/domain/channel-badge';
import { PRIORITY_LABEL, PRIORITY_TONE } from '@/components/domain/presentation-maps';
import { LabelChips } from '@/components/domain/label-chip';
import { cn } from '@/lib/cn';
import { horaLabel } from '@/lib/datetime';

/**
 * Mesma regra da bolha: o instante real manda, o rótulo gravado é reserva.
 * `lastMessageAt` é texto escrito no servidor, e em UTC no histórico antigo.
 */
const horaDaConversa = (conversation: Conversation): string =>
  conversation.lastActivityAt
    ? horaLabel(new Date(conversation.lastActivityAt))
    : conversation.lastMessageAt;

interface ConversationListItemProps {
  readonly conversation: Conversation;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

export function ConversationListItem({
  conversation,
  selected,
  onSelect,
}: ConversationListItemProps) {
  const isGroup = isGroupContact(conversation.contact);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'group relative flex w-full gap-3 border-b border-line-soft p-3 text-left transition-all duration-150',
          selected
            ? 'bg-selected border-l-2 border-l-brand pl-[10px]'
            : 'hover:bg-surface-2/60 active:bg-surface-2',
        )}
      >
        {/* Avatar com status */}
        <div className="relative shrink-0">
          <Avatar
            name={conversation.contact.name}
            tone={conversation.contact.avatarTone}
            src={conversation.contact.avatarUrl}
            size="md"
          />
          {/* Ponto indicador de canal / online */}
          <div className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-surface ring-2 ring-surface">
            <ChannelDot channel={conversation.channel} />
          </div>
        </div>

        {/* Informações da conversa */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5 mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              {isGroup && (
                <Users className="size-3 shrink-0 text-muted" aria-label="Grupo" />
              )}
              <span
                className={cn(
                  'truncate text-xs font-semibold tracking-tight transition-colors',
                  selected ? 'text-brand' : 'text-ink group-hover:text-brand',
                )}
              >
                {conversation.contact.name}
              </span>
            </div>

            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
              {horaDaConversa(conversation)}
            </span>
          </div>

          {/* Prévia da mensagem */}
          <p className="truncate text-xs text-muted leading-snug">
            {conversation.isTyping ? (
              <span className="font-medium text-brand animate-pulse">digitando...</span>
            ) : (
              conversation.lastMessagePreview || 'Nenhuma mensagem recente'
            )}
          </p>

          {/* Tags e Indicador de Não Lidas */}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {conversation.queue && conversation.queue !== 'Geral' && (
              <span className="inline-flex items-center rounded-md bg-surface-2 border border-line-soft px-1.5 py-0.5 text-[10px] font-medium text-muted">
                {conversation.queue}
              </span>
            )}

            {conversation.priority && conversation.priority !== 'baixa' && (
              <Badge tone={PRIORITY_TONE[conversation.priority]}>
                {PRIORITY_LABEL[conversation.priority]}
              </Badge>
            )}

            {conversation.slaLabel && (
              <Badge tone={conversation.slaBreached ? 'red' : 'amber'}>
                {conversation.slaLabel}
              </Badge>
            )}

            <LabelChips labels={conversation.labels} />

            {conversation.unreadCount > 0 && (
              <span className="ml-auto flex min-w-5 h-5 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-white shadow-xs">
                {conversation.unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
