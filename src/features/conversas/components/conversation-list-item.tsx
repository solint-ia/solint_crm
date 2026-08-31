'use client';

import { Users } from 'lucide-react';
import type { Conversation } from '@/core/domain/conversation';
import { isGroupContact } from '@/core/domain/contact';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { TONE_DOT_CLASSES } from '@/components/ui/tone';
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
        {/* Avatar.
            Havia aqui um `ChannelDot` no canto inferior direito. Ele saiu por
            duas razões. A primeira é que não dizia nada: `CHANNELS` tem um
            único canal, então o ponto era verde e idêntico em toda conversa da
            lista — informação que não varia não é informação. A segunda é que
            um ponto verde no canto do avatar é, por convenção, indicador de
            presença: quem olhava lia "este contato está online", que é uma
            coisa que o CRM não sabe e nunca afirmou.
            Quando existir um segundo canal, o lugar de distingui-los é este —
            e aí o ponto volta com significado. */}
        <div className="shrink-0">
          <Avatar
            name={conversation.contact.name}
            tone={conversation.contact.avatarTone}
            src={conversation.contact.avatarUrl}
            size="md"
          />
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

            {/* A prioridade é cor, não texto.
                Um selo escrito "Urgente" competia por largura com a fila, o
                SLA e as etiquetas — que são o que muda de conversa para
                conversa — e empurrava tudo para a linha de baixo. A bolinha
                diz a mesma coisa num quadrado de 6px; o nome continua
                disponível para quem passa o mouse e para o leitor de tela, e
                por extenso na barra da conversa aberta. */}
            {conversation.priority && conversation.priority !== 'baixa' && (
              <span
                title={`Prioridade: ${PRIORITY_LABEL[conversation.priority]}`}
                className="inline-flex shrink-0 items-center"
              >
                <span
                  className={cn(
                    'size-2.5 rounded-full',
                    TONE_DOT_CLASSES[PRIORITY_TONE[conversation.priority]],
                  )}
                />
                <span className="sr-only">
                  Prioridade {PRIORITY_LABEL[conversation.priority]}
                </span>
              </span>
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
