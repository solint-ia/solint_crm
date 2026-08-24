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
          'group relative flex w-full gap-3 border-b border-white/[0.04] p-3 text-left transition-all duration-150',
          selected
            ? 'bg-blue-600/[0.08] border-l-2 border-l-blue-500 pl-[10px]'
            : 'hover:bg-white/[0.03] active:bg-white/[0.05]',
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
                <Users className="size-3 shrink-0 text-slate-400" aria-label="Grupo" />
              )}
              <span
                className={cn(
                  'truncate text-xs font-semibold tracking-tight transition-colors',
                  selected ? 'text-blue-400' : 'text-slate-200 group-hover:text-white',
                )}
              >
                {conversation.contact.name}
              </span>
            </div>

            <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
              {conversation.lastMessageAt}
            </span>
          </div>

          {/* Prévia da mensagem */}
          <p className="truncate text-xs text-slate-400 leading-snug">
            {conversation.isTyping ? (
              <span className="font-medium text-cyan-400 animate-pulse">digitando...</span>
            ) : (
              conversation.lastMessagePreview || 'Nenhuma mensagem recente'
            )}
          </p>

          {/* Tags e Indicador de Não Lidas */}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {conversation.queue && conversation.queue !== 'Geral' && (
              <span className="inline-flex items-center rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
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
              <span className="ml-auto flex min-w-4.5 h-4.5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white shadow-sm shadow-blue-600/30">
                {conversation.unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
