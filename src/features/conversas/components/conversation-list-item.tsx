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
          'flex w-full gap-2.5 border-b border-line-soft px-3.5 py-2.5 text-left transition-all duration-150',
          selected
            ? 'bg-selected border-l-3 border-l-brand pl-[11px]'
            : 'hover:bg-surface-2/70',
        )}
      >
        <Avatar
          name={conversation.contact.name}
          tone={conversation.contact.avatarTone}
          src={conversation.contact.avatarUrl}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <ChannelDot channel={conversation.channel} />
            {isGroup ? (
              <Users className="size-3 shrink-0 text-dim" aria-label="Conversa em grupo" />
            ) : null}
            <span className="truncate text-ui font-bold text-ink tracking-tight">
              {conversation.contact.name}
            </span>
            <span className="ml-auto shrink-0 font-mono text-meta tabular-nums text-dim">
              {conversation.lastMessageAt}
            </span>
          </div>

          <p className="truncate text-body text-muted">
            {conversation.isTyping ? (
              <span className="font-medium text-brand animate-pulse">digitando...</span>
            ) : (
              conversation.lastMessagePreview
            )}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {conversation.queue !== 'Geral' ? (
              <Badge tone="slate">{conversation.queue}</Badge>
            ) : null}
            {conversation.priority !== 'baixa' ? (
              <Badge tone={PRIORITY_TONE[conversation.priority]}>
                {PRIORITY_LABEL[conversation.priority]}
              </Badge>
            ) : null}
            {conversation.slaLabel ? (
              <Badge tone={conversation.slaBreached ? 'red' : 'amber'}>
                {conversation.slaLabel}
              </Badge>
            ) : null}
            <LabelChips labels={conversation.labels} />
            {conversation.unreadCount > 0 ? (
              <span className="ml-auto flex min-w-4.5 h-4.5 items-center justify-center rounded-full bg-brand px-1.5 text-micro font-bold text-white shadow-xs">
                {conversation.unreadCount}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
  );
}
